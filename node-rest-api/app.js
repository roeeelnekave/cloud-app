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
