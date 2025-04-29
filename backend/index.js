    // backend/index.js

    // Import the Express library
    const express = require('express');

    // Create an instance of an Express application
    const app = express();

    // Define the port the server will listen on
    // Use the PORT environment variable if available (common for hosting platforms),
    // otherwise default to 3000
    const PORT = process.env.PORT || 3000;

    // Define a simple route for the root URL ('/')
    // This is just for testing; we'll add real API routes later
    app.get('/', (req, res) => {
      // Send a simple text response
      res.send('Hello from the Translo Backend!');
    });

    // Start the server and make it listen on the defined port
    app.listen(PORT, () => {
      // Log a message to the console once the server is running
      console.log(`Server listening on port ${PORT}`);
    });
    