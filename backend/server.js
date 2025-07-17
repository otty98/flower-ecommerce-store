const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const bodyParser = require('body-parser');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const { body, validationResult } = require('express-validator');

const app = express();
const port = process.env.PORT || 5000;

// Security Middleware
app.use(helmet());
app.use(cors({
    origin: ['http://localhost:5500', 'http://127.0.0.1:5500'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
}));

// Rate Limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// Body Parsing
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// MySQL Connection Pool
const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'bloomstore',
    port: process.env.DB_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    timezone: '+00:00'
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

// Products API
app.get('/api/products', async (req, res) => {
    try {
        const [results] = await pool.query('SELECT * FROM products ORDER BY id DESC');
        console.log(`✅ [GET /api/products] Retrieved ${results.length} products`);
        res.json(results);
    } catch (err) {
        console.error('❌ [GET /api/products] Error:', err.message);
        res.status(500).json({ error: 'Failed to fetch products' });
    }
});

app.get('/api/products/:id', async (req, res) => {
    const productId = parseInt(req.params.id);
    if (isNaN(productId)) {
        return res.status(400).json({ error: 'Invalid product ID' });
    }

    try {
        const [results] = await pool.query('SELECT * FROM products WHERE id = ?', [productId]);
        if (results.length === 0) {
            console.log(`⚠️ [GET /api/products/${productId}] Product not found`);
            return res.status(404).json({ error: 'Product not found' });
        }
        console.log(`✅ [GET /api/products/${productId}] Retrieved product`);
        res.json(results[0]);
    } catch (err) {
        console.error(`❌ [GET /api/products/${productId}] Error:`, err.message);
        res.status(500).json({ error: 'Failed to fetch product' });
    }
});

// Cart API
app.get('/api/cart', async (req, res) => {
    try {
        const [results] = await pool.query('SELECT * FROM cart ORDER BY id DESC');
        console.log(`✅ [GET /api/cart] Retrieved ${results.length} cart items`);
        res.json(results);
    } catch (err) {
        console.error('❌ [GET /api/cart] Error:', err.message);
        res.status(500).json({ error: 'Failed to fetch cart items' });
    }
});

app.post('/api/cart', async (req, res) => {
    const { id, quantity } = req.body;
    
    if (!id || isNaN(parseInt(id)) {
        return res.status(400).json({ error: 'Invalid product ID' });
    }
    
    try {
        // Get product details
        const [productResults] = await pool.query('SELECT * FROM products WHERE id = ?', [id]);
        
        if (productResults.length === 0) {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }
        
        const product = productResults[0];
        
        // Check if item already exists in cart
        const [existingItems] = await pool.query('SELECT * FROM cart WHERE product_id = ?', [id]);
        
        if (existingItems.length > 0) {
            // Update existing item
            const newQuantity = quantity <= 0 ? 0 : quantity;
            
            if (newQuantity <= 0) {
                // Remove item if quantity is 0 or less
                await pool.query('DELETE FROM cart WHERE product_id = ?', [id]);
                console.log(`✅ [POST /api/cart] Removed product ${id} from cart`);
            } else {
                // Update quantity
                await pool.query('UPDATE cart SET quantity = ? WHERE product_id = ?', [newQuantity, id]);
                console.log(`✅ [POST /api/cart] Updated product ${id} quantity to ${newQuantity}`);
            }
        } else if (quantity > 0) {
            // Add new item
            await pool.query(
                'INSERT INTO cart (product_id, name, price, quantity) VALUES (?, ?, ?, ?)',
                [id, product.name, product.price, quantity]
            );
            console.log(`✅ [POST /api/cart] Added product ${id} to cart`);
        }
        
        res.json({ success: true, message: 'Cart updated successfully' });
    } catch (err) {
        console.error('❌ [POST /api/cart] Error:', err.message);
        res.status(500).json({ success: false, message: 'Failed to update cart' });
    }
});

// Orders API - Enhanced Implementation
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

        // 1. Save order
        const [orderResult] = await connection.query(
            'INSERT INTO orders (payment_method, payment_id, amount, status) VALUES (?, ?, ?, ?)',
            [paymentMethod, paymentId, amount, 'pending']
        );
        const orderId = orderResult.insertId;

        // 2. Save order items and update inventory
        for (const item of items) {
            await connection.query(
                'INSERT INTO order_items (order_id, product_id, quantity, price) VALUES (?, ?, ?, ?)',
                [orderId, item.id, item.quantity, item.price]
            );

            // Update product stock (if you have inventory tracking)
            // await connection.query(
            //     'UPDATE products SET stock = stock - ? WHERE id = ?',
            //     [item.quantity, item.id]
            // );
        }

        // 3. Clear the cart
        await connection.query('DELETE FROM cart');

        await connection.commit();
        connection.release();

        console.log(`✅ [POST /api/orders] Created order #${orderId}`);
        res.status(201).json({ 
            success: true, 
            orderId,
            message: 'Order created successfully' 
        });

    } catch (err) {
        if (connection) {
            await connection.rollback();
            connection.release();
        }
        console.error('❌ [POST /api/orders] Error:', err.message);
        res.status(500).json({ 
            success: false, 
            message: 'Order processing failed',
            error: err.message 
        });
    }
});

// Health Check
app.get('/health', async (req, res) => {
    const dbHealthy = await testConnection();
    res.json({
        status: dbHealthy ? 'healthy' : 'degraded',
        database: dbHealthy ? 'connected' : 'disconnected',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('❌ Unhandled error:', err.stack);
    res.status(500).json({ 
        error: 'Internal server error',
        message: 'Something went wrong on our end' 
    });
});

// Start Server
const startServer = async () => {
    try {
        const dbConnected = await testConnection();
        if (!dbConnected) {
            console.error('❌ Failed to connect to database - exiting');
            process.exit(1);
        }

        // Create tables if they don't exist
        await pool.query(`
            CREATE TABLE IF NOT EXISTS products (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                description TEXT,
                price DECIMAL(10,2) NOT NULL,
                image_url VARCHAR(255),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS cart (
                id INT AUTO_INCREMENT PRIMARY KEY,
                product_id INT NOT NULL,
                name VARCHAR(255) NOT NULL,
                price DECIMAL(10,2) NOT NULL,
                quantity INT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (product_id) REFERENCES products(id)
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS orders (
                id INT AUTO_INCREMENT PRIMARY KEY,
                payment_method VARCHAR(50) NOT NULL,
                payment_id VARCHAR(255) NOT NULL,
                amount DECIMAL(10,2) NOT NULL,
                status ENUM('pending', 'completed', 'failed') DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS order_items (
                id INT AUTO_INCREMENT PRIMARY KEY,
                order_id INT NOT NULL,
                product_id INT NOT NULL,
                quantity INT NOT NULL,
                price DECIMAL(10,2) NOT NULL,
                FOREIGN KEY (order_id) REFERENCES orders(id),
                FOREIGN KEY (product_id) REFERENCES products(id)
            )
        `);

        const server = app.listen(port, () => {
            console.log(`\n🚀 Server running at: http://localhost:${port}`);
            console.log('📋 Available API endpoints:');
            console.log('   GET    /api/products      - Get all products');
            console.log('   GET    /api/products/:id  - Get single product');
            console.log('   GET    /api/cart          - Get cart items');
            console.log('   POST   /api/cart          - Add/update cart item');
            console.log('   DELETE /api/cart/:id      - Remove cart item');
            console.log('   DELETE /api/cart          - Clear cart');
            console.log('   POST   /api/orders        - Create order');
            console.log('   GET    /health            - Health check');
        });

        process.on('SIGINT', async () => {
            console.log('\n🛑 Shutting down server...');
            server.close(() => {
                console.log('✅ Server closed');
                process.exit(0);
            });
        });

    } catch (err) {
        console.error('❌ Server startup failed:', err);
        process.exit(1);
    }
};

startServer();