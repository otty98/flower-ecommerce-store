const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors({
    origin: ['http://localhost:5500', 'http://127.0.0.1:5500'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
}));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// MySQL Connection Pool
const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'Owethuu3!',
    database: process.env.DB_NAME || 'bloomstore',
    port: process.env.DB_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    timezone: '+00:00' // Changed from 'UTC' to '+00:00'
});

// Database connection test function
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

// API Routes
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

// Health Check Endpoint
app.get('/health', async (req, res) => {
    const dbHealthy = await testConnection();
    res.json({
        status: dbHealthy ? 'healthy' : 'degraded',
        database: dbHealthy ? 'connected' : 'disconnected',
        timestamp: new Date().toISOString()
    });
});

// Start Server
const startServer = async () => {
    const dbConnected = await testConnection();
    if (!dbConnected) {
        console.error('❌ Failed to connect to database - exiting');
        process.exit(1);
    }

    const server = app.listen(port, () => {
        console.log(`\n🚀 Server running at: http://localhost:${port}`);
        console.log('📋 Available API endpoints:');
        console.log('   GET    /api/products      - Get all products');
        console.log('   GET    /api/products/:id  - Get single product');
        console.log('   GET    /health            - Health check');
    });

    process.on('SIGINT', async () => {
        console.log('\n🛑 Shutting down server...');
        server.close(() => {
            console.log('✅ Server closed');
            process.exit(0);
        });
    });
};

startServer().catch(err => {
    console.error('❌ Failed to start server:', err);
    process.exit(1);
});