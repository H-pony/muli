'use strict';

const path = require('node:path');

if (!process.versions.node || !process.argv[2]) {
  throw new Error('Invalid desktop server launch.');
}

// If the Electron parent crashes, close the private local service as well.
process.on('disconnect', () => process.exit(0));
require(path.join(process.argv[2], 'server.js'));
