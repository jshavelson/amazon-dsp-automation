const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3002;

// Serve static files from the built React app
const distPath = path.join(__dirname, '../platform/frontend/dist');

// Check if dist directory exists
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  
  // For any other route, serve index.html (for React Router)
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
} else {
  console.error('Built React app not found at:', distPath);
  process.exit(1);
}

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Proxy server running on http://localhost:${PORT}`);
  console.log(`Serving React app from: ${distPath}`);
});
