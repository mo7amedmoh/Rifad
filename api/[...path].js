const { createVercelApiProxy } = require('../server/vercel-proxy');

module.exports = createVercelApiProxy();
module.exports.config = { api: { bodyParser: false } };
