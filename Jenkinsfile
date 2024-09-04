pipeline {
    agent { label 'dyagent' }
    environment {
        GITHUB_TOKEN = credentials('github-pat-token')  // Replace with your Jenkins credentials ID for the GitHub PAT
    }
    stages {
        stage("Install GitHub CLI") {
            steps {
                sh '''
                if ! type wget > /dev/null; then
                    sudo apt update && sudo apt-get install wget -y
                fi
                sudo mkdir -p -m 755 /etc/apt/keyrings
                wget -qO- https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null
                sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
                echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null
                sudo apt update
                sudo apt install gh -y
                '''
            }
        }
        stage("Run CloudFormation") {
            steps {
                script {
                    def stackName = 'prodApp'
                    def templateFile = 'cloudformation/main.yaml'
                    def inventoryFile = '/Users/roeeelnekave/Desktop/cloud-app/ansible/inventory.yaml'

                    def stackExists = sh(script: "aws cloudformation describe-stacks --stack-name ${stackName} > /dev/null 2>&1", returnStatus: true) == 0

                    if (stackExists) {
                        sh """
                        aws cloudformation update-stack --stack-name ${stackName} \
                            --template-body file://${templateFile} \
                            --capabilities CAPABILITY_NAMED_IAM
                        """
                    } else {
                        sh """
                        aws cloudformation create-stack --stack-name ${stackName} \
                            --template-body file://${templateFile} \
                            --capabilities CAPABILITY_NAMED_IAM
                        """
                    }
                    
                    // Wait for the stack to be ready
                    sh "aws cloudformation wait stack-create-complete --stack-name ${stackName}"
                }
            }
        }

        stage("Update Inventory") {
            steps {
                script {
                    dir('ansible') {
                        // Get the public IP addresses from the CloudFormation outputs
                        def appDbPublicIP = sh(script: "aws cloudformation describe-stacks --stack-name prodApp --query 'Stacks[0].Outputs[?OutputKey==\\'AppDbInstancePublicIP\\'].OutputValue' --output text", returnStdout: true).trim()
                        def prometheusGrafanaPublicIP = sh(script: "aws cloudformation describe-stacks --stack-name prodApp --query 'Stacks[0].Outputs[?OutputKey==\\'PrometheusGrafanaInstancePublicIP\\'].OutputValue' --output text", returnStdout: true).trim()

                        // Update the Ansible inventory file
                        writeFile file: 'inventory.yaml', text: """
prometheusGrafana:
  hosts:
    ${prometheusGrafanaPublicIP}:
      ansible_user: ubuntu
      ansible_connection: ssh
jenkins:
  hosts:
    34.231.225.144:  # Update with correct IP if needed
      ansible_user: ubuntu
      ansible_connection: ssh
appDb:
  hosts:
    ${appDbPublicIP}:
      ansible_user: ubuntu
      ansible_connection: ssh
                        """
                    }
                }
            }
        }

        stage("Run Ansible") {
            steps {
                withCredentials([file(credentialsId: 'ssh-key-agent', variable: 'AWS_KEY_FILE')]) {
                    dir('ansible') {
                        sh "echo ${AWS_KEY_FILE} > mykey.pem"
                        sh "chmod 400 mykey.pem"
                        sh "ansible-playbook -i inventory.yaml --private-key mykey.pem main.yaml"
                    }
                }
            }
        }
        stage("Setup DB"){
            steps{
                dir('db'){
                    sh "docker-compose up -d"
                }
            }
        }
        stage("Install NPM"){
            steps{
                dir('node-rest-api'){
                    sh "npm install"
                    sh "npm run start-bg"
                }
            }
        }
        stage('Check the app') {
            steps {
                script {
                    // Check if the /status endpoint is working
                    def statusCode = sh(script: "curl -o /dev/null -s -w '%{http_code}' http://localhost:3000/status", returnStdout: true).trim()
                    
                    if (statusCode == '200') {
                        echo "Server is up and running!"
                    } else {
                        error "Server is not responding. Status code: ${statusCode}"
                    }
                }
            }
        }
    }
    post {
        success {
            script {
                def branchName = 'prod'
                def repo = 'owner/repo' // Replace with your GitHub repository in the format 'owner/repo'
                withCredentials([string(credentialsId: 'github-pat-token', variable: 'GITHUB_TOKEN')]) {
                    // Configure GitHub CLI
                    sh '''
                    gh auth login --with-token <<< $GITHUB_TOKEN
                    gh repo set-default --repo ${repo}
                    '''
                    
                    // Check if the 'prod' branch exists
                    def branchExists = sh(script: "gh repo view ${repo} --json branches --jq '.branches[] | select(.name == \"${branchName}\")' | grep ${branchName}", returnStatus: true) == 0

                    if (!branchExists) {
                        // Create the 'prod' branch from the default branch
                        sh """
                        gh repo clone ${repo} temp-repo
                        cd temp-repo
                        git checkout -b ${branchName}
                        git push origin ${branchName}
                        """
                    }

                    // Create a pull request
                    def prTitle = "Create ${branchName} branch"
                    def prBody = "This pull request creates the ${branchName} branch."
                    sh """
                    gh pr create --title '${prTitle}' --body '${prBody}' --base main --head ${branchName} --repo ${repo}
                    """
                    
                    // Clean up
                    sh 'rm -rf temp-repo'
                }
            }
        }
    }
}
