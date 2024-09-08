# Prerequisties

- AWS CLI
- Jenkins
- Nodejs


# Folder Setup
```bash
mkdir -p ./ansible/roles
mkdir -p ./cloudformation
mkdir -p ./node-rest-api
cd ./ansible/roles
ansible-galaxy init cloud-app
ansible-galaxy init prometheusGrafana
ansible-galaxy init jenkins
cd ../..
```
# Jenkins and VPC Setup

- To create VPC and Jenkins Server create `./cloudformation/jenkins.yaml` and paste the following in it 

```yaml
AWSTemplateFormatVersion: '2010-09-09'

Description: |
  This template deploys a VPC, with a pair of public and private subnets, internet gateway, NAT gateway, and a security group.

Parameters:
  EnvironmentName:
    Description: An environment name that is prefixed to resource names
    Type: String
    Default: cloud-app

  VpcCIDR:
    Description: IP range for the VPC
    Type: String
    Default: 10.0.0.0/16

  PublicSubnetCIDR:
    Description: IP range for the public subnet 
    Type: String
    Default: 10.0.1.0/24

  PrivateSubnetCIDR:
    Description: IP range for the private subnet
    Type: String
    Default: 10.0.2.0/24

Resources:
  VPC:
    Type: AWS::EC2::VPC
    Properties:
      CidrBlock: !Ref VpcCIDR
      EnableDnsSupport: true
      EnableDnsHostnames: true
      Tags:
        - Key: Name
          Value: !Ref EnvironmentName

  InternetGateway:
    Type: AWS::EC2::InternetGateway
    Properties:
      Tags:
        - Key: Name
          Value: !Ref EnvironmentName

  InternetGatewayAttachment:
    Type: AWS::EC2::VPCGatewayAttachment
    Properties:
      InternetGatewayId: !Ref InternetGateway
      VpcId: !Ref VPC

  PublicSubnet:
    Type: AWS::EC2::Subnet
    Properties:
      VpcId: !Ref VPC
      AvailabilityZone: !Select [ 0, !GetAZs '' ]
      CidrBlock: !Ref PublicSubnetCIDR
      MapPublicIpOnLaunch: true
      Tags:
        - Key: Name
          Value: !Sub ${EnvironmentName} Public Subnet (AZ1)

  PrivateSubnet:
    Type: AWS::EC2::Subnet
    Properties:
      VpcId: !Ref VPC
      AvailabilityZone: !Select [ 0, !GetAZs  '' ]
      CidrBlock: !Ref PrivateSubnetCIDR
      MapPublicIpOnLaunch: false
      Tags:
        - Key: Name
          Value: !Sub ${EnvironmentName} Private Subnet (AZ1)

  NatGateway1EIP:
    Type: AWS::EC2::EIP
    DependsOn: InternetGatewayAttachment
    Properties:
      Domain: vpc

  NatGateway1:
    Type: AWS::EC2::NatGateway
    Properties:
      AllocationId: !GetAtt NatGateway1EIP.AllocationId
      SubnetId: !Ref PublicSubnet

  PublicRouteTable:
    Type: AWS::EC2::RouteTable
    Properties:
      VpcId: !Ref VPC
      Tags:
        - Key: Name
          Value: !Sub ${EnvironmentName} Public Routes

  DefaultPublicRoute:
    Type: AWS::EC2::Route
    DependsOn: InternetGatewayAttachment
    Properties:
      RouteTableId: !Ref PublicRouteTable
      DestinationCidrBlock: 0.0.0.0/0
      GatewayId: !Ref InternetGateway

  PublicSubnetRouteTableAssociation:
    Type: AWS::EC2::SubnetRouteTableAssociation
    Properties:
      RouteTableId: !Ref PublicRouteTable
      SubnetId: !Ref PublicSubnet

  PrivateRouteTable1:
    Type: AWS::EC2::RouteTable
    Properties:
      VpcId: !Ref VPC
      Tags:
        - Key: Name
          Value: !Sub ${EnvironmentName} Private Routes (AZ1)

  DefaultPrivateRoute1:
    Type: AWS::EC2::Route
    Properties:
      RouteTableId: !Ref PrivateRouteTable1
      DestinationCidrBlock: 0.0.0.0/0
      NatGatewayId: !Ref NatGateway1

  PrivateSubnetRouteTableAssociation:
    Type: AWS::EC2::SubnetRouteTableAssociation
    Properties:
      RouteTableId: !Ref PrivateRouteTable1
      SubnetId: !Ref PrivateSubnet

  InstanceSecurityGroup:
    Type: AWS::EC2::SecurityGroup
    Properties:
      GroupDescription: Allow http, https, and ssh access
      VpcId: !Ref VPC
      SecurityGroupIngress:
        - IpProtocol: tcp
          FromPort: 80
          ToPort: 80
          CidrIp: 0.0.0.0/0
        - IpProtocol: tcp
          FromPort: 22
          ToPort: 22
          CidrIp: 0.0.0.0/0
        - IpProtocol: tcp
          FromPort: 9100
          ToPort: 9100
          CidrIp: 0.0.0.0/0
        - IpProtocol: tcp
          FromPort: 3000
          ToPort: 3000
          CidrIp: 0.0.0.0/0
        - IpProtocol: tcp
          FromPort: 9090
          ToPort: 9090
        - IpProtocol: tcp
          FromPort: 8080
          ToPort: 8080
          CidrIp: 0.0.0.0/0
      SecurityGroupEgress:
        - Description: Allow all outbound traffic
          IpProtocol: "-1"
          CidrIp: 0.0.0.0/0

  InstanceJenkins:
    Type: AWS::EC2::Instance
    Properties: 
      ImageId: ami-0e86e20dae9224db8
      InstanceType: t2.micro
      KeyName: dyagent
      SubnetId: !Ref PublicSubnet
      SecurityGroupIds: 
        - !Ref InstanceSecurityGroup
      Tags:
        - Key: Name
          Value: jenkins


Outputs:
  VPCId:
    Description: The VPC ID
    Value: !Ref VPC
    Export:
      Name: VPCId

  PublicSubnetId:
    Description: The public subnet ID
    Value: !Ref PublicSubnet
    Export:
      Name: PublicSubnetId

  PrivateSubnetId:
    Description: The private subnet ID
    Value: !Ref PrivateSubnet
    Export:
      Name: PrivateSubnetId

  InstanceSecurityGroupId:
    Description: The security group ID
    Value: !Ref InstanceSecurityGroup
    Export:
      Name: InstanceSecurityGroupId

  JenkinsPublicIP:
    Description: Public IP address of the Prometheus and Grafana instance
    Value: !GetAtt InstanceJenkins.PublicIp
    Export:
      Name: JenkinsPublicIP

```

After let's create a Ansible playbook for Jenkins `./ansible/roles/jenkins/tasks/main.yml` paste the following in it
```yaml
---
# tasks file for jenkins
- name: Update apt cache
  ansible.builtin.apt:
    update_cache: yes
  become: true
  
- name: Install java
  ansible.builtin.apt:
    name: 
    - openjdk-17-jdk 
    - openjdk-17-jre
    state: present
  become: true

- name: Download Jenkins keyring
  ansible.builtin.get_url:
    url: https://pkg.jenkins.io/debian-stable/jenkins.io-2023.key
    dest: /usr/share/keyrings/jenkins-keyring.asc
    mode: '0644'
  become: true

- name: Add Jenkins repository to sources list
  ansible.builtin.apt_repository:
    repo: "deb [signed-by=/usr/share/keyrings/jenkins-keyring.asc] https://pkg.jenkins.io/debian-stable binary/"
    state: present
    filename: jenkins
  become: true

- name: Update apt cache
  ansible.builtin.apt:
    update_cache: yes
  become: true

- name: Install Jenkins
  ansible.builtin.apt:
    name: jenkins
    state: present
  become: true
```

- create a `./ansible/ansible.cfg` for making host checking false paste the following in it
```yaml
[defaults]
host_key_checking = False
``` 
- create a `./ansible/jenkins.yaml` for running the playbook paste the follwoing in it 
```yaml
- hosts: jenkins 
  become: true
  tasks: 
    - name: install jenkins
      include_role:
        name: jenkins
```

- Create a inventory to describe our machines `./ansible/inventory` 
```yaml
prometheusGrafana:
  hosts:
    44.198.185.219:
      ansible_user: ubuntu
      ansible_connection: ssh
jenkins:
  hosts:
    34.231.225.144:
      ansible_user: ubuntu
      ansible_connection: ssh
appDb:
  hosts:
    35.175.108.7:
      ansible_user: ubuntu
      ansible_connection: ssh

```

- Create a ansiblerunner file that will run cloudformation in it and update the public ip in the inventory `./ansiblerunner.sh` paste the following in it
```bash
#!/bin/bash
STACK_NAME="jenkins"  
TEMPLATE_FILE="couldformation/jenkins.yaml" 
CAPABILITIES="CAPABILITY_NAMED_IAM"  
REGION="us-east-1"  
INVENTORY_FILE="ansible/inventory.yaml"

echo "Creating CloudFormation stack: $STACK_NAME"
aws cloudformation create-stack \
  --stack-name $STACK_NAME \
  --template-body file://$TEMPLATE_FILE \
  --capabilities $CAPABILITIES \
  --region $REGION 


echo "Waiting for stack creation to complete..."
aws cloudformation wait stack-create-complete \
  --stack-name $STACK_NAME \
  --region $REGION \
  --profile $PROFILE

# Check the result
if [ $? -eq 0 ]; then
  echo "Stack creation completed successfully."
else
  echo "Stack creation failed."
  exit 1
fi


JENKINS_IP=$(aws cloudformation describe-stacks \
    --stack-name $STACK_NAME \
    --query "Stacks[0].Outputs[?OutputKey=='JenkinsPublicIP'].OutputValue" \
    --output text --region $REGION)

if [ -z "$JENKINS_IP" ]; then
  echo "Error: Could not retrieve Jenkins public IP."
  exit 1
fi

sed -i '' "/jenkins:/,/ansible_connection: ssh/s/[0-9]\{1,3\}\.[0-9]\{1,3\}\.[0-9]\{1,3\}\.[0-9]\{1,3\}/$JENKINS_IP/" $INVENTORY_FILE

echo "Updated Jenkins public IP ($JENKINS_IP) in inventory file."
chmod 400 ~/Downloads/dyagent
cd ansible
ansible-playbook -i inventory.yaml --private-key ~/Downloads/dyagent jenkins.yaml
```

- Run the following to run cloudformation stack and use inventory file
```bash
sh ansiblerunner.sh
```
- Now we have configured jenkins in it let's open the jenkins to create a jenkins ec2 dynamic  agent

# Jenkins Agent

Access jenkins through the publiv ip of the jenkins with port 8080 i.e. `<jenkins-ip>:8080` setup the jenkins

- Go to Jenkins Dashboard Click on **Manage Jenkins** Click on **Plugins** Click on **Available Plugins** Search for **Amazon EC2** Select it and Click on **Install**

- Let's create the credentials for AWS Access KEY and AWS Credential
- Sigin in AWS Console navigate to IAM console
- Click on Users > Click on Users > Security Credentials > Access Keys > Create Access Key > Other > Next > Give it description like `jenkinsuser` >  Create access key > Download it as csv and copy that 
- Go to Dashboard > Manage Jenkins > Credentials > System > Global credentials (unrestricted) Click on **+ Add Credentials** 
- Kind **AWS Credentials** Give it a unique `id` like `jenkins-ec2-user` then give it description like `my-jenkins-agent-credentials` then provide your access key id and secret key click on **Create**
- Again  Go to Dashboard > Manage Jenkins > Credentials > System > Global credentials (unrestricted) Click on **+ Add Credentials** 
- Kind **SSH Username with private key** give `id` like `dyagentkey` then give it description like `dyagentkey` username `ubuntu` private key select **Enter Directly** Click on Add Paste the contents of your dyagent key Click `Create`.
- Go Signin to AWS console navigate to Ec2 > launch instances > use ubuntu as ami > key `dyagent` > security group allow 22 > storage 15 GB > Launch Instances 
- Connect instance through ssh run the following 
```bash
sudo apt update
sudo apt install openjdk-17-jdk openjdk-17-jre -y
curl -fsSL https://deb.nodesource.com/setup_20.x -o nodesource_setup.sh
sudo -E bash nodesource_setup.sh
sudo apt-get install -y nodejs
sudo apt-get install unzip -y
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
sudo ./aws/install
(type -p wget >/dev/null || (sudo apt update && sudo apt-get install wget -y)) \
	&& sudo mkdir -p -m 755 /etc/apt/keyrings \
	&& wget -qO- https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null \
	&& sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
	&& echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
	&& sudo apt update \
	&& sudo apt install gh -y
```
- Click on instances and click on actions > image and templates > create image > give it image name as `jenkinsdyagnet` > Create Image > Copy the AMI ID of Image
- Now go to Jenkins Dashboard > Manage Jenkins > Clouds > New Cloud > Cloud Name like `dyagent` > Type `Amazon EC2` > `Amazon EC2 Credentials` select the  `jenkins-ec2-user` > region `us-east-1` > EC2 Key Pair's Private Key `dyagentkey` > Advanced > Instance Cap `1` > AMIs `add`> Description `jenkins agent` > AMI ID `ami id that you copied you previously` > Instance Type `t3.micro` > Security group names `security group id for dyagent` > Remote FS root `/home/ubuntu` > Remote user `ubuntu` > AMI Type `unix` > Labels `dyagent`> Remote SSH port `22` > Click on Advanced > Number of Executors `2` > Subnet IDs for VPC `your public subnet id`> Tags Add >Name `Name` > Value `dyagent` > Click `Save`

- Now create a grafanapromethues and app instances cloudformation `./cloudformation/main.yaml` paste the following in it
```yaml
AWSTemplateFormatVersion: '2010-09-09'

Resources:
  InstanceAppDb:
    Type: AWS::EC2::Instance
    Properties: 
      ImageId: ami-0e86e20dae9224db8
      InstanceType: t2.micro
      KeyName: dyagent
      SubnetId: !ImportValue PublicSubnetId
      SecurityGroupIds: 
        - !ImportValue InstanceSecurityGroupId
      Tags:
        - Key: Name
          Value: appDb

  InstancePrometheusGrafana:
    Type: AWS::EC2::Instance
    Properties: 
      ImageId: ami-0e86e20dae9224db8
      InstanceType: t3.medium
      KeyName: dyagent
      SubnetId: !ImportValue PublicSubnetId
      SecurityGroupIds: 
        - !ImportValue InstanceSecurityGroupId
      Tags:
        - Key: Name
          Value: prometheusGrafana

Outputs:
  InstanceAppDbPublicIP:
    Description: Public IP address of the App DB instance
    Value: !GetAtt InstanceAppDb.PublicIp
    Export:
      Name: AppDbInstancePublicIP

  InstancePrometheusGrafanaPublicIP:
    Description: Public IP address of the Prometheus and Grafana instance
    Value: !GetAtt InstancePrometheusGrafana.PublicIp
    Export:
      Name: PrometheusGrafanaInstancePublicIP

```

- Create Ansible  playbook `./ansible/main.yaml` paste the following in it 
```yaml


- hosts: prometheusGrafana
  become: true
  tasks: 
    - name: install promethues and grafana 
      include_role:
        name: prometheusGrafana

- hosts: appDb
  become: true
  tasks:
    - name: Configure dev environment
      include_role:
        name: cloud-app
```

- For grafanaandpromethues `./ansible/roles/prometheusGrafana/tasks/main.yml` paste the following in it
```yaml
---
- name: Update system packages
  apt:
    update_cache: yes

- name: Create a system group for Prometheus
  group:
    name: "{{ prometheus_group }}"
    system: yes

- name: Create a system user for Prometheus
  user:
    name: "{{ prometheus_user }}"
    shell: /sbin/nologin
    system: yes
    group: "{{ prometheus_group }}"

- name: Create directories for Prometheus
  file:
    path: "{{ item }}"
    state: directory
    owner: "{{ prometheus_user }}"
    group: "{{ prometheus_group }}"
  loop:
    - "{{ prometheus_config_dir }}"
    - "{{ prometheus_data_dir }}"

- name: Download Prometheus
  get_url:
    url: "https://github.com/prometheus/prometheus/releases/download/v{{ prometheus_version }}/prometheus-{{ prometheus_version }}.linux-amd64.tar.gz"
    dest: /tmp/prometheus.tar.gz

- name: Extract Prometheus
  unarchive:
    src: /tmp/prometheus.tar.gz
    dest: /tmp
    remote_src: yes

- name: Move Prometheus binaries
  command: mv /tmp/prometheus-2.43.0.linux-amd64/{{ item }} "{{ prometheus_install_dir }}/"
  loop:
    - prometheus
    - promtool

- name: Remove existing console_libraries directory
  file:
    path: "{{ prometheus_config_dir }}/console_libraries"
    state: absent
    
- name: Remove existing console directory
  file:
    path: "{{ prometheus_config_dir }}/consoles"
    state: absent

- name: Remove existing prometheus.yml file
  file:
    path: "{{ prometheus_config_dir }}/prometheus.yml"
    state: absent

- name: Move configuration files
  command: mv /tmp/prometheus-2.43.0.linux-amd64/{{ item }} "{{ prometheus_config_dir }}/"
  loop:
    - prometheus.yml
    - consoles
    - console_libraries


- name: Set ownership for configuration files
  file:
    path: "{{ prometheus_config_dir }}/{{ item }}"
    owner: "{{ prometheus_user }}"
    group: "{{ prometheus_group }}"
    state: directory
  loop:
    - consoles
    - console_libraries

- name: Create Prometheus systemd service file
  template:
    src: prometheus.service.j2
    dest: /etc/systemd/system/prometheus.service
  become: true

- name: Reload systemd
  command: systemctl daemon-reload
  become: true

- name: Enable and start Prometheus service
  systemd:
    name: prometheus
    enabled: yes
    state: started
  become: true 
- name: Update system packages
  apt:
    update_cache: yes

- name: Ensure /etc/apt/keyrings/ directory exists
  file:
    path: /etc/apt/keyrings/
    state: directory
    mode: '0755'
  become: true
  tags: create_directory

- name: Check if Grafana GPG key already exists
  stat:
    path: /etc/apt/keyrings/grafana.gpg
  register: grafana_gpg_key_stat
  tags: check_gpg_key

- name: Download Grafana GPG key
  get_url:
    url: https://apt.grafana.com/gpg.key
    dest: /tmp/grafana.gpg.key
    mode: '0644'
  tags: download_gpg_key

- name: Convert Grafana GPG key to binary format
  command: gpg --dearmor -o /etc/apt/keyrings/grafana.gpg /tmp/grafana.gpg.key
  become: true
  when: not grafana_gpg_key_stat.stat.exists
  tags: convert_gpg_key

- name: Clean up temporary GPG key file
  file:
    path: /tmp/grafana.gpg.key
    state: absent
  tags: cleanup_gpg_key

- name: Add Grafana stable repository
  lineinfile:
    path: /etc/apt/sources.list.d/grafana.list
    line: 'deb [signed-by=/etc/apt/keyrings/grafana.gpg] https://apt.grafana.com stable main'
    create: yes
  become: true
  tags: add_stable_repo


- name: Update the list of available packages
  apt:
    update_cache: yes
  become: true
  tags: update_package_list

- name: Install Grafana
  apt:
    name: "{{ item }}"
    state: present
  loop: "{{ grafana }}"
  tags: grafana

- name: Ensure Grafana server is enabled and started
  systemd:
    name: grafana-server
    enabled: yes
    state: started
  become: true
  tags: grafana_server

- name: Check Grafana server status
  systemd:
    name: grafana-server
    state: started
  register: grafana_status
  become: true
  tags: check_grafana_status

- name: Display Grafana server status
  debug:
    var: grafana_status
  tags: display_grafana_status

```

- Create the templates for promethues and grafana `./ansible/roles/prometheusGrafana/templates/grafana.conf.j2` paste the following
```jinja
server {
    listen 80;
    server_name {{ domain_name }};  # Replace with your domain or IP address

    location / {
        proxy_pass http://localhost:3000;  # Forward requests to Grafana
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Optional: Handle WebSocket connections for Grafana Live
    location /api/live/ {
        proxy_pass http://localhost:3000/api/live/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```
- Create the templates for promethues and grafana `./ansible/roles/prometheusGrafana/templates/prometheus.service.j2` paste the following
```jinja
[Unit]
Description=Prometheus
Wants=network-online.target
After=network-online.target

[Service]
User={{ prometheus_user }}
Group={{ prometheus_group }}
Type=simple
ExecStart={{ prometheus_install_dir }}/prometheus \
  --config.file {{ prometheus_config_dir }}/prometheus.yml \
  --storage.tsdb.path {{ prometheus_data_dir }} \
  --web.console.templates={{ prometheus_config_dir }}/consoles \
  --web.console.libraries={{ prometheus_config_dir }}/console_libraries

[Install]
WantedBy=multi-user.target
```
- Create the templates for promethues and grafana `./ansible/roles/prometheusGrafana/templates/prometheus.yml.j2` paste the following
```jinja
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'prometheus'
    static_configs:
      - targets: ['localhost:9090']
  - job_name: 'crash-api'
    static_configs:
      - targets: ['{{ cloud_app }}:9100']
```
- Create a vars `./ansible/roles/prometheusGrafana/vars/main.yml` paste the following in it
```yaml
---

packages:
  - apt-transport-https
  - software-properties-common
  - wget
  - nginx
  - certbot
  - python3-certbot-nginx

grafana:
  - grafana
  - grafana-enterprise

domain_name: "grafana.example.com"
email: "example@example.com"

cloud_app: "127.0.0.1"

```

- Create a ansible role of nodeapp and nodeexporter `./ansible/roles/cloud-app/tasks/main.yml` paste the following in it
```yaml
- name: Update apt repo and cache  
  apt: 
    update_cache: yes
    force_apt_get: yes
    cache_valid_time: 3600 


- name: Install npm curl
  apt:
    name: curl
    state: present
  become: true

- name: Download NodeSource setup script
  get_url:
    url: https://deb.nodesource.com/setup_20.x
    dest: /tmp/nodesource_setup.sh
    mode: '0755'
  become: true 

- name: Run NodeSource setup script
  command: bash /tmp/nodesource_setup.sh
  become: true
  
- name: Install Node.js
  apt:
    name: nodejs
    state: present
  become: true

- name: Installing the  node exporter and creating the systemd service
  import_tasks: node_exporter.yaml
 
```

- Create a nodeexporter `./ansible/roles/cloud-app/tasks/node_exporter.yaml` paste the following in it
```yaml
- name: Download Node Exporter binary
  get_url:
    url: https://github.com/prometheus/node_exporter/releases/download/v1.0.1/node_exporter-1.0.1.linux-amd64.tar.gz
    dest: /tmp/node_exporter-1.0.1.linux-amd64.tar.gz

- name: Create Node Exporter group
  group:
    name: node_exporter
    state: present

- name: Create Node Exporter user
  user:
    name: node_exporter
    group: node_exporter
    shell: /sbin/nologin
    create_home: no

- name: Create Node Exporter directory
  file:
    path: /etc/node_exporter
    state: directory
    owner: node_exporter
    group: node_exporter

- name: Unpack Node Exporter binary
  unarchive:
    src: /tmp/node_exporter-1.0.1.linux-amd64.tar.gz
    dest: /tmp/
    remote_src: yes

- name: Remove the Node Exporter binary if it exists
  file:
    path: /usr/bin/node_exporter
    state: absent

- name: Install Node Exporter binary
  ansible.builtin.copy:
    src: "/tmp/node_exporter-1.0.1.linux-amd64/node_exporter"
    dest: /usr/bin/node_exporter
    owner: node_exporter
    group: node_exporter
    mode: '0755'
    remote_src: yes
  become: true

- name: Create Node Exporter service file
  template:
    src: nodeexporter.service.j2     
    dest: /usr/lib/systemd/system/node_exporter.service
  become: true

- name: Reload systemd
  systemd:
    daemon_reload: yes

- name: Start Node Exporter service
  systemd:
    name: node_exporter
    state: started
    enabled: yes

- name: Clean up
  file:
    path: /tmp/node_exporter-1.0.1.linux-amd64.tar.gz
    state: absent
  when: clean_up is defined and clean_up

```

- Create a nodeexporter service `./ansible/roles/cloud-app/templates/nodeexporter.service.j2` paste the following in it
```jinja
[Unit]
Description=Node Exporter
Documentation=https://prometheus.io/docs/guides/node-exporter/
Wants=network-online.target
After=network-online.target

[Service]
User=node_exporter
Group=node_exporter
Type=simple
Restart=on-failure
ExecStart=/usr/bin/node_exporter \
  --web.listen-address=:9100

[Install]
WantedBy=multi-user.target
```

- Create a Jenkinsfile `./Jenkinsfile` paste the following in it
```groovy
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
                withCredentials([file(credentialsId: 'dyagentkey', variable: 'AWS_KEY_FILE')]) {
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

```

-  Create a app.js `./node-rest-api/app.js` paste the following in it
```js
const express = require('express');
const mongoose = require('mongoose');

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;

// הגדרת מודל של MongoDB
const itemSchema = new mongoose.Schema({
  name: { type: String, required: true },
  quantity: { type: Number, required: true }
});

const Item = mongoose.model('Item', itemSchema);

// חיבור ל-MongoDB
const mongoUri = 'mongodb://localhost:27017/mydatabase'; // שנה את ה-URI לפי הצורך

mongoose.connect(mongoUri)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('Failed to connect to MongoDB', err));

// Middleware
app.use((req, res, next) => {
  console.log(`${req.method} request for ${req.url}`);
  next();
});

// מסלול לבדוק שהשרת רץ
app.get('/status', (req, res) => {
  const status = {
    Status: 'Running',
  };
  res.json(status);
});

// מסלול לברך משתמש
app.get('/greet', (req, res) => {
  const name = req.query.name || 'World';
  res.json({ message: `Hello, ${name}!` });
});

// הוספת פריט לאוסף
app.post('/items', async (req, res) => {
  try {
    const newItem = new Item(req.body);
    await newItem.save();
    res.status(201).json({ message: 'Item added', item: newItem });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// קבלת כל הפריטים מהאוסף
app.get('/items', async (req, res) => {
  try {
    const items = await Item.find();
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// עדכון פריט לפי ID
app.put('/items/:id', async (req, res) => {
  try {
    const updatedItem = await Item.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!updatedItem) return res.status(404).json({ message: 'Item not found' });
    res.json({ message: 'Item updated', item: updatedItem });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// מחיקת פריט לפי ID
app.delete('/items/:id', async (req, res) => {
  try {
    const deletedItem = await Item.findByIdAndDelete(req.params.id);
    if (!deletedItem) return res.status(404).json({ message: 'Item not found' });
    res.json({ message: 'Item deleted', item: deletedItem });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// שמיעה על פורט
app.listen(PORT, () => {
  console.log(`Server Listening on PORT: ${PORT}`);
});

```
- Create package.json `./node-rest-api/package.json` paste the following in it
```json
{
  "name": "cloud-app",
  "version": "1.0.0",
  "main": "index.js",
  "scripts": {
    "test": "echo \"Error: no test specified\" && exit 1",
    "start-bg": "node server.mjs &"
  },
  "author": "",
  "license": "ISC",
  "description": "",
  "dependencies": {
    "express": "^4.19.2",
    "mongoose": "^8.6.0"
  }
}

```

- Create a package.lock.json `./node-rest-api/package-lock.json` paste the following in it
```yaml
{
  "name": "cloud-app",
  "version": "1.0.0",
  "lockfileVersion": 3,
  "requires": true,
  "packages": {
    "": {
      "name": "cloud-app",
      "version": "1.0.0",
      "license": "ISC",
      "dependencies": {
        "express": "^4.19.2",
        "mongoose": "^8.6.0"
      }
    },
    "node_modules/@mongodb-js/saslprep": {
      "version": "1.1.9",
      "resolved": "https://registry.npmjs.org/@mongodb-js/saslprep/-/saslprep-1.1.9.tgz",
      "integrity": "sha512-tVkljjeEaAhCqTzajSdgbQ6gE6f3oneVwa3iXR6csiEwXXOFsiC6Uh9iAjAhXPtqa/XMDHWjjeNH/77m/Yq2dw==",
      "license": "MIT",
      "dependencies": {
        "sparse-bitfield": "^3.0.3"
      }
    },
    "node_modules/@types/webidl-conversions": {
      "version": "7.0.3",
      "resolved": "https://registry.npmjs.org/@types/webidl-conversions/-/webidl-conversions-7.0.3.tgz",
      "integrity": "sha512-CiJJvcRtIgzadHCYXw7dqEnMNRjhGZlYK05Mj9OyktqV8uVT8fD2BFOB7S1uwBE3Kj2Z+4UyPmFw/Ixgw/LAlA==",
      "license": "MIT"
    },
    "node_modules/@types/whatwg-url": {
      "version": "11.0.5",
      "resolved": "https://registry.npmjs.org/@types/whatwg-url/-/whatwg-url-11.0.5.tgz",
      "integrity": "sha512-coYR071JRaHa+xoEvvYqvnIHaVqaYrLPbsufM9BF63HkwI5Lgmy2QR8Q5K/lYDYo5AK82wOvSOS0UsLTpTG7uQ==",
      "license": "MIT",
      "dependencies": {
        "@types/webidl-conversions": "*"
      }
    },
    "node_modules/accepts": {
      "version": "1.3.8",
      "resolved": "https://registry.npmjs.org/accepts/-/accepts-1.3.8.tgz",
      "integrity": "sha512-PYAthTa2m2VKxuvSD3DPC/Gy+U+sOA1LAuT8mkmRuvw+NACSaeXEQ+NHcVF7rONl6qcaxV3Uuemwawk+7+SJLw==",
      "license": "MIT",
      "dependencies": {
        "mime-types": "~2.1.34",
        "negotiator": "0.6.3"
      },
      "engines": {
        "node": ">= 0.6"
      }
    },
    "node_modules/array-flatten": {
      "version": "1.1.1",
      "resolved": "https://registry.npmjs.org/array-flatten/-/array-flatten-1.1.1.tgz",
      "integrity": "sha512-PCVAQswWemu6UdxsDFFX/+gVeYqKAod3D3UVm91jHwynguOwAvYPhx8nNlM++NqRcK6CxxpUafjmhIdKiHibqg==",
      "license": "MIT"
    },
    "node_modules/body-parser": {
      "version": "1.20.2",
      "resolved": "https://registry.npmjs.org/body-parser/-/body-parser-1.20.2.tgz",
      "integrity": "sha512-ml9pReCu3M61kGlqoTm2umSXTlRTuGTx0bfYj+uIUKKYycG5NtSbeetV3faSU6R7ajOPw0g/J1PvK4qNy7s5bA==",
      "license": "MIT",
      "dependencies": {
        "bytes": "3.1.2",
        "content-type": "~1.0.5",
        "debug": "2.6.9",
        "depd": "2.0.0",
        "destroy": "1.2.0",
        "http-errors": "2.0.0",
        "iconv-lite": "0.4.24",
        "on-finished": "2.4.1",
        "qs": "6.11.0",
        "raw-body": "2.5.2",
        "type-is": "~1.6.18",
        "unpipe": "1.0.0"
      },
      "engines": {
        "node": ">= 0.8",
        "npm": "1.2.8000 || >= 1.4.16"
      }
    },
    "node_modules/bson": {
      "version": "6.8.0",
      "resolved": "https://registry.npmjs.org/bson/-/bson-6.8.0.tgz",
      "integrity": "sha512-iOJg8pr7wq2tg/zSlCCHMi3hMm5JTOxLTagf3zxhcenHsFp+c6uOs6K7W5UE7A4QIJGtqh/ZovFNMP4mOPJynQ==",
      "license": "Apache-2.0",
      "engines": {
        "node": ">=16.20.1"
      }
    },
    "node_modules/bytes": {
      "version": "3.1.2",
      "resolved": "https://registry.npmjs.org/bytes/-/bytes-3.1.2.tgz",
      "integrity": "sha512-/Nf7TyzTx6S3yRJObOAV7956r8cr2+Oj8AC5dt8wSP3BQAoeX58NoHyCU8P8zGkNXStjTSi6fzO6F0pBdcYbEg==",
      "license": "MIT",
      "engines": {
        "node": ">= 0.8"
      }
    },
    "node_modules/call-bind": {
      "version": "1.0.7",
      "resolved": "https://registry.npmjs.org/call-bind/-/call-bind-1.0.7.tgz",
      "integrity": "sha512-GHTSNSYICQ7scH7sZ+M2rFopRoLh8t2bLSW6BbgrtLsahOIB5iyAVJf9GjWK3cYTDaMj4XdBpM1cA6pIS0Kv2w==",
      "license": "MIT",
      "dependencies": {
        "es-define-property": "^1.0.0",
        "es-errors": "^1.3.0",
        "function-bind": "^1.1.2",
        "get-intrinsic": "^1.2.4",
        "set-function-length": "^1.2.1"
      },
      "engines": {
        "node": ">= 0.4"
      },
      "funding": {
        "url": "https://github.com/sponsors/ljharb"
      }
    },
    "node_modules/content-disposition": {
      "version": "0.5.4",
      "resolved": "https://registry.npmjs.org/content-disposition/-/content-disposition-0.5.4.tgz",
      "integrity": "sha512-FveZTNuGw04cxlAiWbzi6zTAL/lhehaWbTtgluJh4/E95DqMwTmha3KZN1aAWA8cFIhHzMZUvLevkw5Rqk+tSQ==",
      "license": "MIT",
      "dependencies": {
        "safe-buffer": "5.2.1"
      },
      "engines": {
        "node": ">= 0.6"
      }
    },
    "node_modules/content-type": {
      "version": "1.0.5",
      "resolved": "https://registry.npmjs.org/content-type/-/content-type-1.0.5.tgz",
      "integrity": "sha512-nTjqfcBFEipKdXCv4YDQWCfmcLZKm81ldF0pAopTvyrFGVbcR6P/VAAd5G7N+0tTr8QqiU0tFadD6FK4NtJwOA==",
      "license": "MIT",
      "engines": {
        "node": ">= 0.6"
      }
    },
    "node_modules/cookie": {
      "version": "0.6.0",
      "resolved": "https://registry.npmjs.org/cookie/-/cookie-0.6.0.tgz",
      "integrity": "sha512-U71cyTamuh1CRNCfpGY6to28lxvNwPG4Guz/EVjgf3Jmzv0vlDp1atT9eS5dDjMYHucpHbWns6Lwf3BKz6svdw==",
      "license": "MIT",
      "engines": {
        "node": ">= 0.6"
      }
    },
    "node_modules/cookie-signature": {
      "version": "1.0.6",
      "resolved": "https://registry.npmjs.org/cookie-signature/-/cookie-signature-1.0.6.tgz",
      "integrity": "sha512-QADzlaHc8icV8I7vbaJXJwod9HWYp8uCqf1xa4OfNu1T7JVxQIrUgOWtHdNDtPiywmFbiS12VjotIXLrKM3orQ==",
      "license": "MIT"
    },
    "node_modules/debug": {
      "version": "2.6.9",
      "resolved": "https://registry.npmjs.org/debug/-/debug-2.6.9.tgz",
      "integrity": "sha512-bC7ElrdJaJnPbAP+1EotYvqZsb3ecl5wi6Bfi6BJTUcNowp6cvspg0jXznRTKDjm/E7AdgFBVeAPVMNcKGsHMA==",
      "license": "MIT",
      "dependencies": {
        "ms": "2.0.0"
      }
    },
    "node_modules/define-data-property": {
      "version": "1.1.4",
      "resolved": "https://registry.npmjs.org/define-data-property/-/define-data-property-1.1.4.tgz",
      "integrity": "sha512-rBMvIzlpA8v6E+SJZoo++HAYqsLrkg7MSfIinMPFhmkorw7X+dOXVJQs+QT69zGkzMyfDnIMN2Wid1+NbL3T+A==",
      "license": "MIT",
      "dependencies": {
        "es-define-property": "^1.0.0",
        "es-errors": "^1.3.0",
        "gopd": "^1.0.1"
      },
      "engines": {
        "node": ">= 0.4"
      },
      "funding": {
        "url": "https://github.com/sponsors/ljharb"
      }
    },
    "node_modules/depd": {
      "version": "2.0.0",
      "resolved": "https://registry.npmjs.org/depd/-/depd-2.0.0.tgz",
      "integrity": "sha512-g7nH6P6dyDioJogAAGprGpCtVImJhpPk/roCzdb3fIh61/s/nPsfR6onyMwkCAR/OlC3yBC0lESvUoQEAssIrw==",
      "license": "MIT",
      "engines": {
        "node": ">= 0.8"
      }
    },
    "node_modules/destroy": {
      "version": "1.2.0",
      "resolved": "https://registry.npmjs.org/destroy/-/destroy-1.2.0.tgz",
      "integrity": "sha512-2sJGJTaXIIaR1w4iJSNoN0hnMY7Gpc/n8D4qSCJw8QqFWXf7cuAgnEHxBpweaVcPevC2l3KpjYCx3NypQQgaJg==",
      "license": "MIT",
      "engines": {
        "node": ">= 0.8",
        "npm": "1.2.8000 || >= 1.4.16"
      }
    },
    "node_modules/ee-first": {
      "version": "1.1.1",
      "resolved": "https://registry.npmjs.org/ee-first/-/ee-first-1.1.1.tgz",
      "integrity": "sha512-WMwm9LhRUo+WUaRN+vRuETqG89IgZphVSNkdFgeb6sS/E4OrDIN7t48CAewSHXc6C8lefD8KKfr5vY61brQlow==",
      "license": "MIT"
    },
    "node_modules/encodeurl": {
      "version": "1.0.2",
      "resolved": "https://registry.npmjs.org/encodeurl/-/encodeurl-1.0.2.tgz",
      "integrity": "sha512-TPJXq8JqFaVYm2CWmPvnP2Iyo4ZSM7/QKcSmuMLDObfpH5fi7RUGmd/rTDf+rut/saiDiQEeVTNgAmJEdAOx0w==",
      "license": "MIT",
      "engines": {
        "node": ">= 0.8"
      }
    },
    "node_modules/es-define-property": {
      "version": "1.0.0",
      "resolved": "https://registry.npmjs.org/es-define-property/-/es-define-property-1.0.0.tgz",
      "integrity": "sha512-jxayLKShrEqqzJ0eumQbVhTYQM27CfT1T35+gCgDFoL82JLsXqTJ76zv6A0YLOgEnLUMvLzsDsGIrl8NFpT2gQ==",
      "license": "MIT",
      "dependencies": {
        "get-intrinsic": "^1.2.4"
      },
      "engines": {
        "node": ">= 0.4"
      }
    },
    "node_modules/es-errors": {
      "version": "1.3.0",
      "resolved": "https://registry.npmjs.org/es-errors/-/es-errors-1.3.0.tgz",
      "integrity": "sha512-Zf5H2Kxt2xjTvbJvP2ZWLEICxA6j+hAmMzIlypy4xcBg1vKVnx89Wy0GbS+kf5cwCVFFzdCFh2XSCFNULS6csw==",
      "license": "MIT",
      "engines": {
        "node": ">= 0.4"
      }
    },
    "node_modules/escape-html": {
      "version": "1.0.3",
      "resolved": "https://registry.npmjs.org/escape-html/-/escape-html-1.0.3.tgz",
      "integrity": "sha512-NiSupZ4OeuGwr68lGIeym/ksIZMJodUGOSCZ/FSnTxcrekbvqrgdUxlJOMpijaKZVjAJrWrGs/6Jy8OMuyj9ow==",
      "license": "MIT"
    },
    "node_modules/etag": {
      "version": "1.8.1",
      "resolved": "https://registry.npmjs.org/etag/-/etag-1.8.1.tgz",
      "integrity": "sha512-aIL5Fx7mawVa300al2BnEE4iNvo1qETxLrPI/o05L7z6go7fCw1J6EQmbK4FmJ2AS7kgVF/KEZWufBfdClMcPg==",
      "license": "MIT",
      "engines": {
        "node": ">= 0.6"
      }
    },
    "node_modules/express": {
      "version": "4.19.2",
      "resolved": "https://registry.npmjs.org/express/-/express-4.19.2.tgz",
      "integrity": "sha512-5T6nhjsT+EOMzuck8JjBHARTHfMht0POzlA60WV2pMD3gyXw2LZnZ+ueGdNxG+0calOJcWKbpFcuzLZ91YWq9Q==",
      "license": "MIT",
      "dependencies": {
        "accepts": "~1.3.8",
        "array-flatten": "1.1.1",
        "body-parser": "1.20.2",
        "content-disposition": "0.5.4",
        "content-type": "~1.0.4",
        "cookie": "0.6.0",
        "cookie-signature": "1.0.6",
        "debug": "2.6.9",
        "depd": "2.0.0",
        "encodeurl": "~1.0.2",
        "escape-html": "~1.0.3",
        "etag": "~1.8.1",
        "finalhandler": "1.2.0",
        "fresh": "0.5.2",
        "http-errors": "2.0.0",
        "merge-descriptors": "1.0.1",
        "methods": "~1.1.2",
        "on-finished": "2.4.1",
        "parseurl": "~1.3.3",
        "path-to-regexp": "0.1.7",
        "proxy-addr": "~2.0.7",
        "qs": "6.11.0",
        "range-parser": "~1.2.1",
        "safe-buffer": "5.2.1",
        "send": "0.18.0",
        "serve-static": "1.15.0",
        "setprototypeof": "1.2.0",
        "statuses": "2.0.1",
        "type-is": "~1.6.18",
        "utils-merge": "1.0.1",
        "vary": "~1.1.2"
      },
      "engines": {
        "node": ">= 0.10.0"
      }
    },
    "node_modules/finalhandler": {
      "version": "1.2.0",
      "resolved": "https://registry.npmjs.org/finalhandler/-/finalhandler-1.2.0.tgz",
      "integrity": "sha512-5uXcUVftlQMFnWC9qu/svkWv3GTd2PfUhK/3PLkYNAe7FbqJMt3515HaxE6eRL74GdsriiwujiawdaB1BpEISg==",
      "license": "MIT",
      "dependencies": {
        "debug": "2.6.9",
        "encodeurl": "~1.0.2",
        "escape-html": "~1.0.3",
        "on-finished": "2.4.1",
        "parseurl": "~1.3.3",
        "statuses": "2.0.1",
        "unpipe": "~1.0.0"
      },
      "engines": {
        "node": ">= 0.8"
      }
    },
    "node_modules/forwarded": {
      "version": "0.2.0",
      "resolved": "https://registry.npmjs.org/forwarded/-/forwarded-0.2.0.tgz",
      "integrity": "sha512-buRG0fpBtRHSTCOASe6hD258tEubFoRLb4ZNA6NxMVHNw2gOcwHo9wyablzMzOA5z9xA9L1KNjk/Nt6MT9aYow==",
      "license": "MIT",
      "engines": {
        "node": ">= 0.6"
      }
    },
    "node_modules/fresh": {
      "version": "0.5.2",
      "resolved": "https://registry.npmjs.org/fresh/-/fresh-0.5.2.tgz",
      "integrity": "sha512-zJ2mQYM18rEFOudeV4GShTGIQ7RbzA7ozbU9I/XBpm7kqgMywgmylMwXHxZJmkVoYkna9d2pVXVXPdYTP9ej8Q==",
      "license": "MIT",
      "engines": {
        "node": ">= 0.6"
      }
    },
    "node_modules/function-bind": {
      "version": "1.1.2",
      "resolved": "https://registry.npmjs.org/function-bind/-/function-bind-1.1.2.tgz",
      "integrity": "sha512-7XHNxH7qX9xG5mIwxkhumTox/MIRNcOgDrxWsMt2pAr23WHp6MrRlN7FBSFpCpr+oVO0F744iUgR82nJMfG2SA==",
      "license": "MIT",
      "funding": {
        "url": "https://github.com/sponsors/ljharb"
      }
    },
    "node_modules/get-intrinsic": {
      "version": "1.2.4",
      "resolved": "https://registry.npmjs.org/get-intrinsic/-/get-intrinsic-1.2.4.tgz",
      "integrity": "sha512-5uYhsJH8VJBTv7oslg4BznJYhDoRI6waYCxMmCdnTrcCrHA/fCFKoTFz2JKKE0HdDFUF7/oQuhzumXJK7paBRQ==",
      "license": "MIT",
      "dependencies": {
        "es-errors": "^1.3.0",
        "function-bind": "^1.1.2",
        "has-proto": "^1.0.1",
        "has-symbols": "^1.0.3",
        "hasown": "^2.0.0"
      },
      "engines": {
        "node": ">= 0.4"
      },
      "funding": {
        "url": "https://github.com/sponsors/ljharb"
      }
    },
    "node_modules/gopd": {
      "version": "1.0.1",
      "resolved": "https://registry.npmjs.org/gopd/-/gopd-1.0.1.tgz",
      "integrity": "sha512-d65bNlIadxvpb/A2abVdlqKqV563juRnZ1Wtk6s1sIR8uNsXR70xqIzVqxVf1eTqDunwT2MkczEeaezCKTZhwA==",
      "license": "MIT",
      "dependencies": {
        "get-intrinsic": "^1.1.3"
      },
      "funding": {
        "url": "https://github.com/sponsors/ljharb"
      }
    },
    "node_modules/has-property-descriptors": {
      "version": "1.0.2",
      "resolved": "https://registry.npmjs.org/has-property-descriptors/-/has-property-descriptors-1.0.2.tgz",
      "integrity": "sha512-55JNKuIW+vq4Ke1BjOTjM2YctQIvCT7GFzHwmfZPGo5wnrgkid0YQtnAleFSqumZm4az3n2BS+erby5ipJdgrg==",
      "license": "MIT",
      "dependencies": {
        "es-define-property": "^1.0.0"
      },
      "funding": {
        "url": "https://github.com/sponsors/ljharb"
      }
    },
    "node_modules/has-proto": {
      "version": "1.0.3",
      "resolved": "https://registry.npmjs.org/has-proto/-/has-proto-1.0.3.tgz",
      "integrity": "sha512-SJ1amZAJUiZS+PhsVLf5tGydlaVB8EdFpaSO4gmiUKUOxk8qzn5AIy4ZeJUmh22znIdk/uMAUT2pl3FxzVUH+Q==",
      "license": "MIT",
      "engines": {
        "node": ">= 0.4"
      },
      "funding": {
        "url": "https://github.com/sponsors/ljharb"
      }
    },
    "node_modules/has-symbols": {
      "version": "1.0.3",
      "resolved": "https://registry.npmjs.org/has-symbols/-/has-symbols-1.0.3.tgz",
      "integrity": "sha512-l3LCuF6MgDNwTDKkdYGEihYjt5pRPbEg46rtlmnSPlUbgmB8LOIrKJbYYFBSbnPaJexMKtiPO8hmeRjRz2Td+A==",
      "license": "MIT",
      "engines": {
        "node": ">= 0.4"
      },
      "funding": {
        "url": "https://github.com/sponsors/ljharb"
      }
    },
    "node_modules/hasown": {
      "version": "2.0.2",
      "resolved": "https://registry.npmjs.org/hasown/-/hasown-2.0.2.tgz",
      "integrity": "sha512-0hJU9SCPvmMzIBdZFqNPXWa6dqh7WdH0cII9y+CyS8rG3nL48Bclra9HmKhVVUHyPWNH5Y7xDwAB7bfgSjkUMQ==",
      "license": "MIT",
      "dependencies": {
        "function-bind": "^1.1.2"
      },
      "engines": {
        "node": ">= 0.4"
      }
    },
    "node_modules/http-errors": {
      "version": "2.0.0",
      "resolved": "https://registry.npmjs.org/http-errors/-/http-errors-2.0.0.tgz",
      "integrity": "sha512-FtwrG/euBzaEjYeRqOgly7G0qviiXoJWnvEH2Z1plBdXgbyjv34pHTSb9zoeHMyDy33+DWy5Wt9Wo+TURtOYSQ==",
      "license": "MIT",
      "dependencies": {
        "depd": "2.0.0",
        "inherits": "2.0.4",
        "setprototypeof": "1.2.0",
        "statuses": "2.0.1",
        "toidentifier": "1.0.1"
      },
      "engines": {
        "node": ">= 0.8"
      }
    },
    "node_modules/iconv-lite": {
      "version": "0.4.24",
      "resolved": "https://registry.npmjs.org/iconv-lite/-/iconv-lite-0.4.24.tgz",
      "integrity": "sha512-v3MXnZAcvnywkTUEZomIActle7RXXeedOR31wwl7VlyoXO4Qi9arvSenNQWne1TcRwhCL1HwLI21bEqdpj8/rA==",
      "license": "MIT",
      "dependencies": {
        "safer-buffer": ">= 2.1.2 < 3"
      },
      "engines": {
        "node": ">=0.10.0"
      }
    },
    "node_modules/inherits": {
      "version": "2.0.4",
      "resolved": "https://registry.npmjs.org/inherits/-/inherits-2.0.4.tgz",
      "integrity": "sha512-k/vGaX4/Yla3WzyMCvTQOXYeIHvqOKtnqBduzTHpzpQZzAskKMhZ2K+EnBiSM9zGSoIFeMpXKxa4dYeZIQqewQ==",
      "license": "ISC"
    },
    "node_modules/ipaddr.js": {
      "version": "1.9.1",
      "resolved": "https://registry.npmjs.org/ipaddr.js/-/ipaddr.js-1.9.1.tgz",
      "integrity": "sha512-0KI/607xoxSToH7GjN1FfSbLoU0+btTicjsQSWQlh/hZykN8KpmMf7uYwPW3R+akZ6R/w18ZlXSHBYXiYUPO3g==",
      "license": "MIT",
      "engines": {
        "node": ">= 0.10"
      }
    },
    "node_modules/kareem": {
      "version": "2.6.3",
      "resolved": "https://registry.npmjs.org/kareem/-/kareem-2.6.3.tgz",
      "integrity": "sha512-C3iHfuGUXK2u8/ipq9LfjFfXFxAZMQJJq7vLS45r3D9Y2xQ/m4S8zaR4zMLFWh9AsNPXmcFfUDhTEO8UIC/V6Q==",
      "license": "Apache-2.0",
      "engines": {
        "node": ">=12.0.0"
      }
    },
    "node_modules/media-typer": {
      "version": "0.3.0",
      "resolved": "https://registry.npmjs.org/media-typer/-/media-typer-0.3.0.tgz",
      "integrity": "sha512-dq+qelQ9akHpcOl/gUVRTxVIOkAJ1wR3QAvb4RsVjS8oVoFjDGTc679wJYmUmknUF5HwMLOgb5O+a3KxfWapPQ==",
      "license": "MIT",
      "engines": {
        "node": ">= 0.6"
      }
    },
    "node_modules/memory-pager": {
      "version": "1.5.0",
      "resolved": "https://registry.npmjs.org/memory-pager/-/memory-pager-1.5.0.tgz",
      "integrity": "sha512-ZS4Bp4r/Zoeq6+NLJpP+0Zzm0pR8whtGPf1XExKLJBAczGMnSi3It14OiNCStjQjM6NU1okjQGSxgEZN8eBYKg==",
      "license": "MIT"
    },
    "node_modules/merge-descriptors": {
      "version": "1.0.1",
      "resolved": "https://registry.npmjs.org/merge-descriptors/-/merge-descriptors-1.0.1.tgz",
      "integrity": "sha512-cCi6g3/Zr1iqQi6ySbseM1Xvooa98N0w31jzUYrXPX2xqObmFGHJ0tQ5u74H3mVh7wLouTseZyYIq39g8cNp1w==",
      "license": "MIT"
    },
    "node_modules/methods": {
      "version": "1.1.2",
      "resolved": "https://registry.npmjs.org/methods/-/methods-1.1.2.tgz",
      "integrity": "sha512-iclAHeNqNm68zFtnZ0e+1L2yUIdvzNoauKU4WBA3VvH/vPFieF7qfRlwUZU+DA9P9bPXIS90ulxoUoCH23sV2w==",
      "license": "MIT",
      "engines": {
        "node": ">= 0.6"
      }
    },
    "node_modules/mime": {
      "version": "1.6.0",
      "resolved": "https://registry.npmjs.org/mime/-/mime-1.6.0.tgz",
      "integrity": "sha512-x0Vn8spI+wuJ1O6S7gnbaQg8Pxh4NNHb7KSINmEWKiPE4RKOplvijn+NkmYmmRgP68mc70j2EbeTFRsrswaQeg==",
      "license": "MIT",
      "bin": {
        "mime": "cli.js"
      },
      "engines": {
        "node": ">=4"
      }
    },
    "node_modules/mime-db": {
      "version": "1.52.0",
      "resolved": "https://registry.npmjs.org/mime-db/-/mime-db-1.52.0.tgz",
      "integrity": "sha512-sPU4uV7dYlvtWJxwwxHD0PuihVNiE7TyAbQ5SWxDCB9mUYvOgroQOwYQQOKPJ8CIbE+1ETVlOoK1UC2nU3gYvg==",
      "license": "MIT",
      "engines": {
        "node": ">= 0.6"
      }
    },
    "node_modules/mime-types": {
      "version": "2.1.35",
      "resolved": "https://registry.npmjs.org/mime-types/-/mime-types-2.1.35.tgz",
      "integrity": "sha512-ZDY+bPm5zTTF+YpCrAU9nK0UgICYPT0QtT1NZWFv4s++TNkcgVaT0g6+4R2uI4MjQjzysHB1zxuWL50hzaeXiw==",
      "license": "MIT",
      "dependencies": {
        "mime-db": "1.52.0"
      },
      "engines": {
        "node": ">= 0.6"
      }
    },
    "node_modules/mongodb": {
      "version": "6.8.0",
      "resolved": "https://registry.npmjs.org/mongodb/-/mongodb-6.8.0.tgz",
      "integrity": "sha512-HGQ9NWDle5WvwMnrvUxsFYPd3JEbqD3RgABHBQRuoCEND0qzhsd0iH5ypHsf1eJ+sXmvmyKpP+FLOKY8Il7jMw==",
      "license": "Apache-2.0",
      "dependencies": {
        "@mongodb-js/saslprep": "^1.1.5",
        "bson": "^6.7.0",
        "mongodb-connection-string-url": "^3.0.0"
      },
      "engines": {
        "node": ">=16.20.1"
      },
      "peerDependencies": {
        "@aws-sdk/credential-providers": "^3.188.0",
        "@mongodb-js/zstd": "^1.1.0",
        "gcp-metadata": "^5.2.0",
        "kerberos": "^2.0.1",
        "mongodb-client-encryption": ">=6.0.0 <7",
        "snappy": "^7.2.2",
        "socks": "^2.7.1"
      },
      "peerDependenciesMeta": {
        "@aws-sdk/credential-providers": {
          "optional": true
        },
        "@mongodb-js/zstd": {
          "optional": true
        },
        "gcp-metadata": {
          "optional": true
        },
        "kerberos": {
          "optional": true
        },
        "mongodb-client-encryption": {
          "optional": true
        },
        "snappy": {
          "optional": true
        },
        "socks": {
          "optional": true
        }
      }
    },
    "node_modules/mongodb-connection-string-url": {
      "version": "3.0.1",
      "resolved": "https://registry.npmjs.org/mongodb-connection-string-url/-/mongodb-connection-string-url-3.0.1.tgz",
      "integrity": "sha512-XqMGwRX0Lgn05TDB4PyG2h2kKO/FfWJyCzYQbIhXUxz7ETt0I/FqHjUeqj37irJ+Dl1ZtU82uYyj14u2XsZKfg==",
      "license": "Apache-2.0",
      "dependencies": {
        "@types/whatwg-url": "^11.0.2",
        "whatwg-url": "^13.0.0"
      }
    },
    "node_modules/mongoose": {
      "version": "8.6.0",
      "resolved": "https://registry.npmjs.org/mongoose/-/mongoose-8.6.0.tgz",
      "integrity": "sha512-p6VSbYKvD4ZIabqo8C0kS5eKX1Xpji+opTAIJ9wyuPJ8Y/FblgXSMnFRXnB40bYZLKPQT089K5KU8+bqIXtFdw==",
      "license": "MIT",
      "dependencies": {
        "bson": "^6.7.0",
        "kareem": "2.6.3",
        "mongodb": "6.8.0",
        "mpath": "0.9.0",
        "mquery": "5.0.0",
        "ms": "2.1.3",
        "sift": "17.1.3"
      },
      "engines": {
        "node": ">=16.20.1"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/mongoose"
      }
    },
    "node_modules/mongoose/node_modules/ms": {
      "version": "2.1.3",
      "resolved": "https://registry.npmjs.org/ms/-/ms-2.1.3.tgz",
      "integrity": "sha512-6FlzubTLZG3J2a/NVCAleEhjzq5oxgHyaCU9yYXvcLsvoVaHJq/s5xXI6/XXP6tz7R9xAOtHnSO/tXtF3WRTlA==",
      "license": "MIT"
    },
    "node_modules/mpath": {
      "version": "0.9.0",
      "resolved": "https://registry.npmjs.org/mpath/-/mpath-0.9.0.tgz",
      "integrity": "sha512-ikJRQTk8hw5DEoFVxHG1Gn9T/xcjtdnOKIU1JTmGjZZlg9LST2mBLmcX3/ICIbgJydT2GOc15RnNy5mHmzfSew==",
      "license": "MIT",
      "engines": {
        "node": ">=4.0.0"
      }
    },
    "node_modules/mquery": {
      "version": "5.0.0",
      "resolved": "https://registry.npmjs.org/mquery/-/mquery-5.0.0.tgz",
      "integrity": "sha512-iQMncpmEK8R8ncT8HJGsGc9Dsp8xcgYMVSbs5jgnm1lFHTZqMJTUWTDx1LBO8+mK3tPNZWFLBghQEIOULSTHZg==",
      "license": "MIT",
      "dependencies": {
        "debug": "4.x"
      },
      "engines": {
        "node": ">=14.0.0"
      }
    },
    "node_modules/mquery/node_modules/debug": {
      "version": "4.3.6",
      "resolved": "https://registry.npmjs.org/debug/-/debug-4.3.6.tgz",
      "integrity": "sha512-O/09Bd4Z1fBrU4VzkhFqVgpPzaGbw6Sm9FEkBT1A/YBXQFGuuSxa1dN2nxgxS34JmKXqYx8CZAwEVoJFImUXIg==",
      "license": "MIT",
      "dependencies": {
        "ms": "2.1.2"
      },
      "engines": {
        "node": ">=6.0"
      },
      "peerDependenciesMeta": {
        "supports-color": {
          "optional": true
        }
      }
    },
    "node_modules/mquery/node_modules/ms": {
      "version": "2.1.2",
      "resolved": "https://registry.npmjs.org/ms/-/ms-2.1.2.tgz",
      "integrity": "sha512-sGkPx+VjMtmA6MX27oA4FBFELFCZZ4S4XqeGOXCv68tT+jb3vk/RyaKWP0PTKyWtmLSM0b+adUTEvbs1PEaH2w==",
      "license": "MIT"
    },
    "node_modules/ms": {
      "version": "2.0.0",
      "resolved": "https://registry.npmjs.org/ms/-/ms-2.0.0.tgz",
      "integrity": "sha512-Tpp60P6IUJDTuOq/5Z8cdskzJujfwqfOTkrwIwj7IRISpnkJnT6SyJ4PCPnGMoFjC9ddhal5KVIYtAt97ix05A==",
      "license": "MIT"
    },
    "node_modules/negotiator": {
      "version": "0.6.3",
      "resolved": "https://registry.npmjs.org/negotiator/-/negotiator-0.6.3.tgz",
      "integrity": "sha512-+EUsqGPLsM+j/zdChZjsnX51g4XrHFOIXwfnCVPGlQk/k5giakcKsuxCObBRu6DSm9opw/O6slWbJdghQM4bBg==",
      "license": "MIT",
      "engines": {
        "node": ">= 0.6"
      }
    },
    "node_modules/object-inspect": {
      "version": "1.13.2",
      "resolved": "https://registry.npmjs.org/object-inspect/-/object-inspect-1.13.2.tgz",
      "integrity": "sha512-IRZSRuzJiynemAXPYtPe5BoI/RESNYR7TYm50MC5Mqbd3Jmw5y790sErYw3V6SryFJD64b74qQQs9wn5Bg/k3g==",
      "license": "MIT",
      "engines": {
        "node": ">= 0.4"
      },
      "funding": {
        "url": "https://github.com/sponsors/ljharb"
      }
    },
    "node_modules/on-finished": {
      "version": "2.4.1",
      "resolved": "https://registry.npmjs.org/on-finished/-/on-finished-2.4.1.tgz",
      "integrity": "sha512-oVlzkg3ENAhCk2zdv7IJwd/QUD4z2RxRwpkcGY8psCVcCYZNq4wYnVWALHM+brtuJjePWiYF/ClmuDr8Ch5+kg==",
      "license": "MIT",
      "dependencies": {
        "ee-first": "1.1.1"
      },
      "engines": {
        "node": ">= 0.8"
      }
    },
    "node_modules/parseurl": {
      "version": "1.3.3",
      "resolved": "https://registry.npmjs.org/parseurl/-/parseurl-1.3.3.tgz",
      "integrity": "sha512-CiyeOxFT/JZyN5m0z9PfXw4SCBJ6Sygz1Dpl0wqjlhDEGGBP1GnsUVEL0p63hoG1fcj3fHynXi9NYO4nWOL+qQ==",
      "license": "MIT",
      "engines": {
        "node": ">= 0.8"
      }
    },
    "node_modules/path-to-regexp": {
      "version": "0.1.7",
      "resolved": "https://registry.npmjs.org/path-to-regexp/-/path-to-regexp-0.1.7.tgz",
      "integrity": "sha512-5DFkuoqlv1uYQKxy8omFBeJPQcdoE07Kv2sferDCrAq1ohOU+MSDswDIbnx3YAM60qIOnYa53wBhXW0EbMonrQ==",
      "license": "MIT"
    },
    "node_modules/proxy-addr": {
      "version": "2.0.7",
      "resolved": "https://registry.npmjs.org/proxy-addr/-/proxy-addr-2.0.7.tgz",
      "integrity": "sha512-llQsMLSUDUPT44jdrU/O37qlnifitDP+ZwrmmZcoSKyLKvtZxpyV0n2/bD/N4tBAAZ/gJEdZU7KMraoK1+XYAg==",
      "license": "MIT",
      "dependencies": {
        "forwarded": "0.2.0",
        "ipaddr.js": "1.9.1"
      },
      "engines": {
        "node": ">= 0.10"
      }
    },
    "node_modules/punycode": {
      "version": "2.3.1",
      "resolved": "https://registry.npmjs.org/punycode/-/punycode-2.3.1.tgz",
      "integrity": "sha512-vYt7UD1U9Wg6138shLtLOvdAu+8DsC/ilFtEVHcH+wydcSpNE20AfSOduf6MkRFahL5FY7X1oU7nKVZFtfq8Fg==",
      "license": "MIT",
      "engines": {
        "node": ">=6"
      }
    },
    "node_modules/qs": {
      "version": "6.11.0",
      "resolved": "https://registry.npmjs.org/qs/-/qs-6.11.0.tgz",
      "integrity": "sha512-MvjoMCJwEarSbUYk5O+nmoSzSutSsTwF85zcHPQ9OrlFoZOYIjaqBAJIqIXjptyD5vThxGq52Xu/MaJzRkIk4Q==",
      "license": "BSD-3-Clause",
      "dependencies": {
        "side-channel": "^1.0.4"
      },
      "engines": {
        "node": ">=0.6"
      },
      "funding": {
        "url": "https://github.com/sponsors/ljharb"
      }
    },
    "node_modules/range-parser": {
      "version": "1.2.1",
      "resolved": "https://registry.npmjs.org/range-parser/-/range-parser-1.2.1.tgz",
      "integrity": "sha512-Hrgsx+orqoygnmhFbKaHE6c296J+HTAQXoxEF6gNupROmmGJRoyzfG3ccAveqCBrwr/2yxQ5BVd/GTl5agOwSg==",
      "license": "MIT",
      "engines": {
        "node": ">= 0.6"
      }
    },
    "node_modules/raw-body": {
      "version": "2.5.2",
      "resolved": "https://registry.npmjs.org/raw-body/-/raw-body-2.5.2.tgz",
      "integrity": "sha512-8zGqypfENjCIqGhgXToC8aB2r7YrBX+AQAfIPs/Mlk+BtPTztOvTS01NRW/3Eh60J+a48lt8qsCzirQ6loCVfA==",
      "license": "MIT",
      "dependencies": {
        "bytes": "3.1.2",
        "http-errors": "2.0.0",
        "iconv-lite": "0.4.24",
        "unpipe": "1.0.0"
      },
      "engines": {
        "node": ">= 0.8"
      }
    },
    "node_modules/safe-buffer": {
      "version": "5.2.1",
      "resolved": "https://registry.npmjs.org/safe-buffer/-/safe-buffer-5.2.1.tgz",
      "integrity": "sha512-rp3So07KcdmmKbGvgaNxQSJr7bGVSVk5S9Eq1F+ppbRo70+YeaDxkw5Dd8NPN+GD6bjnYm2VuPuCXmpuYvmCXQ==",
      "funding": [
        {
          "type": "github",
          "url": "https://github.com/sponsors/feross"
        },
        {
          "type": "patreon",
          "url": "https://www.patreon.com/feross"
        },
        {
          "type": "consulting",
          "url": "https://feross.org/support"
        }
      ],
      "license": "MIT"
    },
    "node_modules/safer-buffer": {
      "version": "2.1.2",
      "resolved": "https://registry.npmjs.org/safer-buffer/-/safer-buffer-2.1.2.tgz",
      "integrity": "sha512-YZo3K82SD7Riyi0E1EQPojLz7kpepnSQI9IyPbHHg1XXXevb5dJI7tpyN2ADxGcQbHG7vcyRHk0cbwqcQriUtg==",
      "license": "MIT"
    },
    "node_modules/send": {
      "version": "0.18.0",
      "resolved": "https://registry.npmjs.org/send/-/send-0.18.0.tgz",
      "integrity": "sha512-qqWzuOjSFOuqPjFe4NOsMLafToQQwBSOEpS+FwEt3A2V3vKubTquT3vmLTQpFgMXp8AlFWFuP1qKaJZOtPpVXg==",
      "license": "MIT",
      "dependencies": {
        "debug": "2.6.9",
        "depd": "2.0.0",
        "destroy": "1.2.0",
        "encodeurl": "~1.0.2",
        "escape-html": "~1.0.3",
        "etag": "~1.8.1",
        "fresh": "0.5.2",
        "http-errors": "2.0.0",
        "mime": "1.6.0",
        "ms": "2.1.3",
        "on-finished": "2.4.1",
        "range-parser": "~1.2.1",
        "statuses": "2.0.1"
      },
      "engines": {
        "node": ">= 0.8.0"
      }
    },
    "node_modules/send/node_modules/ms": {
      "version": "2.1.3",
      "resolved": "https://registry.npmjs.org/ms/-/ms-2.1.3.tgz",
      "integrity": "sha512-6FlzubTLZG3J2a/NVCAleEhjzq5oxgHyaCU9yYXvcLsvoVaHJq/s5xXI6/XXP6tz7R9xAOtHnSO/tXtF3WRTlA==",
      "license": "MIT"
    },
    "node_modules/serve-static": {
      "version": "1.15.0",
      "resolved": "https://registry.npmjs.org/serve-static/-/serve-static-1.15.0.tgz",
      "integrity": "sha512-XGuRDNjXUijsUL0vl6nSD7cwURuzEgglbOaFuZM9g3kwDXOWVTck0jLzjPzGD+TazWbboZYu52/9/XPdUgne9g==",
      "license": "MIT",
      "dependencies": {
        "encodeurl": "~1.0.2",
        "escape-html": "~1.0.3",
        "parseurl": "~1.3.3",
        "send": "0.18.0"
      },
      "engines": {
        "node": ">= 0.8.0"
      }
    },
    "node_modules/set-function-length": {
      "version": "1.2.2",
      "resolved": "https://registry.npmjs.org/set-function-length/-/set-function-length-1.2.2.tgz",
      "integrity": "sha512-pgRc4hJ4/sNjWCSS9AmnS40x3bNMDTknHgL5UaMBTMyJnU90EgWh1Rz+MC9eFu4BuN/UwZjKQuY/1v3rM7HMfg==",
      "license": "MIT",
      "dependencies": {
        "define-data-property": "^1.1.4",
        "es-errors": "^1.3.0",
        "function-bind": "^1.1.2",
        "get-intrinsic": "^1.2.4",
        "gopd": "^1.0.1",
        "has-property-descriptors": "^1.0.2"
      },
      "engines": {
        "node": ">= 0.4"
      }
    },
    "node_modules/setprototypeof": {
      "version": "1.2.0",
      "resolved": "https://registry.npmjs.org/setprototypeof/-/setprototypeof-1.2.0.tgz",
      "integrity": "sha512-E5LDX7Wrp85Kil5bhZv46j8jOeboKq5JMmYM3gVGdGH8xFpPWXUMsNrlODCrkoxMEeNi/XZIwuRvY4XNwYMJpw==",
      "license": "ISC"
    },
    "node_modules/side-channel": {
      "version": "1.0.6",
      "resolved": "https://registry.npmjs.org/side-channel/-/side-channel-1.0.6.tgz",
      "integrity": "sha512-fDW/EZ6Q9RiO8eFG8Hj+7u/oW+XrPTIChwCOM2+th2A6OblDtYYIpve9m+KvI9Z4C9qSEXlaGR6bTEYHReuglA==",
      "license": "MIT",
      "dependencies": {
        "call-bind": "^1.0.7",
        "es-errors": "^1.3.0",
        "get-intrinsic": "^1.2.4",
        "object-inspect": "^1.13.1"
      },
      "engines": {
        "node": ">= 0.4"
      },
      "funding": {
        "url": "https://github.com/sponsors/ljharb"
      }
    },
    "node_modules/sift": {
      "version": "17.1.3",
      "resolved": "https://registry.npmjs.org/sift/-/sift-17.1.3.tgz",
      "integrity": "sha512-Rtlj66/b0ICeFzYTuNvX/EF1igRbbnGSvEyT79McoZa/DeGhMyC5pWKOEsZKnpkqtSeovd5FL/bjHWC3CIIvCQ==",
      "license": "MIT"
    },
    "node_modules/sparse-bitfield": {
      "version": "3.0.3",
      "resolved": "https://registry.npmjs.org/sparse-bitfield/-/sparse-bitfield-3.0.3.tgz",
      "integrity": "sha512-kvzhi7vqKTfkh0PZU+2D2PIllw2ymqJKujUcyPMd9Y75Nv4nPbGJZXNhxsgdQab2BmlDct1YnfQCguEvHr7VsQ==",
      "license": "MIT",
      "dependencies": {
        "memory-pager": "^1.0.2"
      }
    },
    "node_modules/statuses": {
      "version": "2.0.1",
      "resolved": "https://registry.npmjs.org/statuses/-/statuses-2.0.1.tgz",
      "integrity": "sha512-RwNA9Z/7PrK06rYLIzFMlaF+l73iwpzsqRIFgbMLbTcLD6cOao82TaWefPXQvB2fOC4AjuYSEndS7N/mTCbkdQ==",
      "license": "MIT",
      "engines": {
        "node": ">= 0.8"
      }
    },
    "node_modules/toidentifier": {
      "version": "1.0.1",
      "resolved": "https://registry.npmjs.org/toidentifier/-/toidentifier-1.0.1.tgz",
      "integrity": "sha512-o5sSPKEkg/DIQNmH43V0/uerLrpzVedkUh8tGNvaeXpfpuwjKenlSox/2O/BTlZUtEe+JG7s5YhEz608PlAHRA==",
      "license": "MIT",
      "engines": {
        "node": ">=0.6"
      }
    },
    "node_modules/tr46": {
      "version": "4.1.1",
      "resolved": "https://registry.npmjs.org/tr46/-/tr46-4.1.1.tgz",
      "integrity": "sha512-2lv/66T7e5yNyhAAC4NaKe5nVavzuGJQVVtRYLyQ2OI8tsJ61PMLlelehb0wi2Hx6+hT/OJUWZcw8MjlSRnxvw==",
      "license": "MIT",
      "dependencies": {
        "punycode": "^2.3.0"
      },
      "engines": {
        "node": ">=14"
      }
    },
    "node_modules/type-is": {
      "version": "1.6.18",
      "resolved": "https://registry.npmjs.org/type-is/-/type-is-1.6.18.tgz",
      "integrity": "sha512-TkRKr9sUTxEH8MdfuCSP7VizJyzRNMjj2J2do2Jr3Kym598JVdEksuzPQCnlFPW4ky9Q+iA+ma9BGm06XQBy8g==",
      "license": "MIT",
      "dependencies": {
        "media-typer": "0.3.0",
        "mime-types": "~2.1.24"
      },
      "engines": {
        "node": ">= 0.6"
      }
    },
    "node_modules/unpipe": {
      "version": "1.0.0",
      "resolved": "https://registry.npmjs.org/unpipe/-/unpipe-1.0.0.tgz",
      "integrity": "sha512-pjy2bYhSsufwWlKwPc+l3cN7+wuJlK6uz0YdJEOlQDbl6jo/YlPi4mb8agUkVC8BF7V8NuzeyPNqRksA3hztKQ==",
      "license": "MIT",
      "engines": {
        "node": ">= 0.8"
      }
    },
    "node_modules/utils-merge": {
      "version": "1.0.1",
      "resolved": "https://registry.npmjs.org/utils-merge/-/utils-merge-1.0.1.tgz",
      "integrity": "sha512-pMZTvIkT1d+TFGvDOqodOclx0QWkkgi6Tdoa8gC8ffGAAqz9pzPTZWAybbsHHoED/ztMtkv/VoYTYyShUn81hA==",
      "license": "MIT",
      "engines": {
        "node": ">= 0.4.0"
      }
    },
    "node_modules/vary": {
      "version": "1.1.2",
      "resolved": "https://registry.npmjs.org/vary/-/vary-1.1.2.tgz",
      "integrity": "sha512-BNGbWLfd0eUPabhkXUVm0j8uuvREyTh5ovRa/dyow/BqAbZJyC+5fU+IzQOzmAKzYqYRAISoRhdQr3eIZ/PXqg==",
      "license": "MIT",
      "engines": {
        "node": ">= 0.8"
      }
    },
    "node_modules/webidl-conversions": {
      "version": "7.0.0",
      "resolved": "https://registry.npmjs.org/webidl-conversions/-/webidl-conversions-7.0.0.tgz",
      "integrity": "sha512-VwddBukDzu71offAQR975unBIGqfKZpM+8ZX6ySk8nYhVoo5CYaZyzt3YBvYtRtO+aoGlqxPg/B87NGVZ/fu6g==",
      "license": "BSD-2-Clause",
      "engines": {
        "node": ">=12"
      }
    },
    "node_modules/whatwg-url": {
      "version": "13.0.0",
      "resolved": "https://registry.npmjs.org/whatwg-url/-/whatwg-url-13.0.0.tgz",
      "integrity": "sha512-9WWbymnqj57+XEuqADHrCJ2eSXzn8WXIW/YSGaZtb2WKAInQ6CHfaUUcTyyver0p8BDg5StLQq8h1vtZuwmOig==",
      "license": "MIT",
      "dependencies": {
        "tr46": "^4.1.1",
        "webidl-conversions": "^7.0.0"
      },
      "engines": {
        "node": ">=16"
      }
    }
  }
}

```
- Create a `./.gitignore` paste the following in it 
```
node_modules
```

- Create a `./docker-compose.yaml` for the mongodb paste the following in it
```yaml
services:  
  mongo:
    image: mongo:latest
    container_name: mongodb
    ports:
      - "27017:27017"
    volumes:
      - mongo-data:/data/db

volumes:
  mongo-data:
    driver: local
```

- Push to github and create a jenkins pipeline from scm and click build now
