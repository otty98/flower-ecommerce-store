const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const bodyParser = require('body-parser');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const path = require('path');
const { body, validationResult } = require('express-validator');

const app = express();
const port = process.env.PORT || 5000;
require('dotenv').config();

// Security Middleware with relaxed CSP for development
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            imgSrc: ["'self'", "data:", "https:", "http:"],
            connectSrc: ["'self'"]
        }
    }
}));

app.use(cors({
    origin: '*',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
}));

app.use(express.json());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Serve frontend static files
app.use(express.static(path.join(__dirname, 'public')));

// Rate Limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 100
});
app.use(limiter);

// MySQL Connection Pool
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Database connection test
const testConnection = async () => {
    try {
        const connection = await pool.getConnection();
        await connection.ping();
        connection.release();
        console.log('✅ Database connection test successful');
        return true;
    } catch (err) {
        console.error('❌ Database connection failed:', err.message);
        return false;
    }
};

// Validation middleware
const validateOrder = [
    body('paymentMethod').isString().notEmpty(),
    body('paymentId').isString().notEmpty(),
    body('amount').isFloat({ min: 0 }),
    body('items').isArray({ min: 1 }),
    body('items.*.id').isInt({ min: 1 }),
    body('items.*.quantity').isInt({ min: 1 }),
    body('items.*.price').isFloat({ min: 0 })
];

// API Routes
app.get('/api/products', async (req, res) => {
    try {
        const [results] = await pool.query('SELECT * FROM products ORDER BY id DESC');
        res.json(results);
    } catch (err) {
        console.error('❌ [GET /api/products] Error:', err.message);
        res.status(500).json({ error: 'Failed to fetch products' });
    }
});

app.get('/api/cart', async (req, res) => {
    try {
        const [results] = await pool.query('SELECT * FROM cart ORDER BY id DESC');
        res.json(results);
    } catch (err) {
        console.error('❌ [GET /api/cart] Error:', err.message);
        res.status(500).json({ error: 'Failed to fetch cart items' });
    }
});

app.post('/api/cart', async (req, res) => {
    if (!req.body || !req.body.id) {
        return res.status(400).json({ error: 'Missing product ID' });
    }

    const { id, quantity = 1 } = req.body;
    const productId = parseInt(id);
    const newQuantity = parseInt(quantity);

    if (isNaN(productId) || productId <= 0 || isNaN(newQuantity) || newQuantity < 0) {
        return res.status(400).json({ error: 'Invalid input' });
    }

    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const [products] = await connection.query(
            'SELECT id, name, price FROM products WHERE id = ? FOR UPDATE', [productId]
        );
        if (products.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Product not found' });
        }

        const product = products[0];
        const [cartItems] = await connection.query(
            'SELECT * FROM cart WHERE product_id = ? FOR UPDATE', [productId]
        );

        if (cartItems.length > 0) {
            if (newQuantity <= 0) {
                await connection.query('DELETE FROM cart WHERE product_id = ?', [productId]);
            } else {
                await connection.query('UPDATE cart SET quantity = ? WHERE product_id = ?', [newQuantity, productId]);
            }
        } else if (newQuantity > 0) {
            await connection.query(
                'INSERT INTO cart (product_id, name, price, quantity) VALUES (?, ?, ?, ?)',
                [productId, product.name, product.price, newQuantity]
            );
        }

        await connection.commit();

        const [updatedCart] = await pool.query('SELECT * FROM cart ORDER BY id DESC');
        res.json({ success: true, cart: updatedCart });

    } catch (err) {
        if (connection) await connection.rollback();
        console.error('❌ [POST /api/cart] Error:', err.message);
        res.status(500).json({ error: 'Failed to update cart' });
    } finally {
        if (connection) connection.release();
    }
});

// Orders API
app.post('/api/orders', validateOrder, async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { paymentMethod, paymentId, amount, items } = req.body;
    let connection;

    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const [orderResult] = await connection.query(
            'INSERT INTO orders (payment_method, payment_id, amount, status) VALUES (?, ?, ?, ?)',
            [paymentMethod, paymentId, amount, 'pending']
        );
        const orderId = orderResult.insertId;

        for (const item of items) {
            await connection.query(
                'INSERT INTO order_items (order_id, product_id, quantity, price) VALUES (?, ?, ?, ?)',
                [orderId, item.id, item.quantity, item.price]
            );
        }

        await connection.query('DELETE FROM cart');
        await connection.commit();

        res.status(201).json({ success: true, orderId });

    } catch (err) {
        if (connection) await connection.rollback();
        console.error('❌ [POST /api/orders] Error:', err.message);
        res.status(500).json({ error: 'Order processing failed' });
    } finally {
        if (connection) connection.release();
    }
});

// Catch-all route for SPA
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
const startServer = async () => {
    const dbConnected = await testConnection();
    if (!dbConnected) {
        console.error('❌ Failed to connect to database');
        process.exit(1);
    }

    app.listen(port, () => {
        console.log(`🚀 Server running on http://localhost:${port}`);
    });
};

startServer();