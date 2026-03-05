const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname)); // serves index.html

// ── MongoDB Atlas Connection ──
const MONGO_URI = 'mongodb+srv://spchalke2811_db_user:SPChalke2811@cluster0.8hariap.mongodb.net/?appName=Cluster0&tls=true&tlsAllowInvalidCertificates=true';
const DB_NAME = 'modernbank';

let db;

// ── Helper ──
const users = () => db.collection('users');
const txs   = () => db.collection('transactions');

// ── ROUTES ──

// Sign Up
app.post('/api/signup', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'All fields required.' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });

    const exists = await users().findOne({ email });
    if (exists) return res.status(400).json({ error: 'Email already registered.' });

    const user = {
      name, email, password,
      accountNumber: 'ACC' + Math.floor(100000 + Math.random() * 900000),
      ifsc: 'MB' + Math.floor(10000 + Math.random() * 90000),
      balance: 1000,
      joined: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
      createdAt: new Date()
    };

    const result = await users().insertOne(user);
    const newUser = { ...user, id: result.insertedId.toString() };
    delete newUser.password;

    // Welcome bonus transaction
    await txs().insertOne({
      userId: result.insertedId.toString(),
      type: 'credit', amount: 1000,
      description: 'Welcome Bonus 🎉',
      date: new Date().toLocaleString(),
      createdAt: new Date()
    });

    res.json({ user: newUser });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await users().findOne({ email, password });
    if (!user) return res.status(401).json({ error: 'Invalid credentials.' });
    const safeUser = { ...user, id: user._id.toString() };
    delete safeUser.password;
    delete safeUser._id;
    res.json({ user: safeUser });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get user (refresh balance etc.)
app.get('/api/user/:id', async (req, res) => {
  try {
    const { ObjectId } = require('mongodb');
    const user = await users().findOne({ _id: new ObjectId(req.params.id) });
    if (!user) return res.status(404).json({ error: 'User not found.' });
    const safeUser = { ...user, id: user._id.toString() };
    delete safeUser.password; delete safeUser._id;
    res.json({ user: safeUser });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get transactions for user
app.get('/api/transactions/:userId', async (req, res) => {
  try {
    const list = await txs()
      .find({ userId: req.params.userId })
      .sort({ createdAt: -1 })
      .toArray();
    res.json({ transactions: list });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Deposit
app.post('/api/deposit', async (req, res) => {
  try {
    const { ObjectId } = require('mongodb');
    const { userId, amount, description } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount.' });

    await users().updateOne({ _id: new ObjectId(userId) }, { $inc: { balance: amount } });
    await txs().insertOne({ userId, type: 'credit', amount, description: description || 'Deposit', date: new Date().toLocaleString(), createdAt: new Date() });

    const user = await users().findOne({ _id: new ObjectId(userId) });
    const safeUser = { ...user, id: user._id.toString() };
    delete safeUser.password; delete safeUser._id;
    res.json({ user: safeUser });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Withdraw
app.post('/api/withdraw', async (req, res) => {
  try {
    const { ObjectId } = require('mongodb');
    const { userId, amount, description } = req.body;
    const user = await users().findOne({ _id: new ObjectId(userId) });
    if (!user) return res.status(404).json({ error: 'User not found.' });
    if (amount > user.balance) return res.status(400).json({ error: 'Insufficient funds.' });

    await users().updateOne({ _id: new ObjectId(userId) }, { $inc: { balance: -amount } });
    await txs().insertOne({ userId, type: 'debit', amount, description: description || 'Withdrawal', date: new Date().toLocaleString(), createdAt: new Date() });

    const updated = await users().findOne({ _id: new ObjectId(userId) });
    const safeUser = { ...updated, id: updated._id.toString() };
    delete safeUser.password; delete safeUser._id;
    res.json({ user: safeUser });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Transfer
app.post('/api/transfer', async (req, res) => {
  try {
    const { ObjectId } = require('mongodb');
    const { userId, toAccountNumber, amount, description } = req.body;
    const sender = await users().findOne({ _id: new ObjectId(userId) });
    const recipient = await users().findOne({ accountNumber: toAccountNumber });

    if (!recipient) return res.status(404).json({ error: 'Account not found.' });
    if (recipient._id.toString() === userId) return res.status(400).json({ error: 'Cannot transfer to yourself.' });
    if (amount > sender.balance) return res.status(400).json({ error: 'Insufficient funds.' });

    await users().updateOne({ _id: new ObjectId(userId) }, { $inc: { balance: -amount } });
    await users().updateOne({ _id: recipient._id }, { $inc: { balance: amount } });

    const now = new Date();
    await txs().insertMany([
      { userId, type: 'debit', amount, description: `Transfer → ${recipient.name}`, date: now.toLocaleString(), createdAt: now },
      { userId: recipient._id.toString(), type: 'credit', amount, description: `Transfer ← ${sender.name}`, date: now.toLocaleString(), createdAt: now }
    ]);

    const updated = await users().findOne({ _id: new ObjectId(userId) });
    const safeUser = { ...updated, id: updated._id.toString() };
    delete safeUser.password; delete safeUser._id;
    res.json({ user: safeUser, recipientName: recipient.name });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── START ──
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 ModernBank server running at http://localhost:${PORT}`));
