// ===================================================================================
// --- Final SyncFlo Backend Server ---
// This includes the critical CORS fix AND the correct port for Render.
// ===================================================================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
// THIS IS THE FIX: Render's default port is 10000, not 3000.
const PORT = process.env.PORT || 10000; 

// --- Middleware ---
app.use(cors());
app.use(express.json());

// --- Database Connection ---
const pool = new Pool({
  connectionString: process.env.DB_CONNECTION_STRING,
  ssl: {
    rejectUnauthorized: false
  }
});

// --- API Routes ---

// Health check route
app.get('/', (req, res) => {
  res.send('SyncFlo Backend is running and configured correctly!');
});

// 1. Find or Create a User
app.post('/api/user/find-or-create', async (req, res) => {
  const { email, fullName } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Email is required.' });
  }
  try {
    let userResult = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (userResult.rows.length > 0) {
      res.json(userResult.rows[0]);
    } else {
      let newUserResult = await pool.query(
        'INSERT INTO users (email, full_name) VALUES ($1, $2) RETURNING *',
        [email, fullName || 'New User']
      );
      res.status(201).json(newUserResult.rows[0]);
    }
  } catch (err) {
    console.error('Error in /api/user/find-or-create:', err.message);
    res.status(500).json({ error: 'Database error while finding or creating user.' });
  }
});

// 2. Get User's Current Subscription
app.get('/api/subscription/:userId', async (req, res) => {
    const { userId } = req.params;
    try {
        const result = await pool.query(
            `SELECT s.*, p.name as plan_name, p.price_in_inr, p.features 
             FROM subscriptions s 
             JOIN plans p ON s.plan_id = p.plan_id 
             WHERE s.user_id = $1 AND s.status = 'active'`, 
            [userId]
        );
        if (result.rows.length > 0) {
            res.json(result.rows[0]);
        } else {
            res.status(404).json({ error: 'No active subscription found.' });
        }
    } catch (err) {
        console.error('Error in /api/subscription/:userId:', err.message);
        res.status(500).json({ error: 'Database error fetching subscription.' });
    }
});

// 3. Get User's Billing History
app.get('/api/billing-history/:userId', async (req, res) => {
    const { userId } = req.params;
    try {
        const result = await pool.query('SELECT * FROM billing_history WHERE user_id = $1 ORDER BY invoice_date DESC', [userId]);
        res.json(result.rows);
    } catch (err) {
        console.error('Error in /api/billing-history/:userId:', err.message);
        res.status(500).json({ error: 'Database error fetching billing history.' });
    }
});

// 4. Get All Available Plans
app.get('/api/plans', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM plans');
        res.json(result.rows);
    } catch (err) {
        console.error('Error in /api/plans:', err.message);
        res.status(500).json({ error: 'Database error fetching plans.' });
    }
});

// --- Start the Server ---
app.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
});
