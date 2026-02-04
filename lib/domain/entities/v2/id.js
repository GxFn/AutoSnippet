const crypto = require('crypto');

function generateId(prefix = 'id') {
  if (typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`;
  }

  return `${prefix}_${crypto.randomBytes(16).toString('hex')}`;
}

module.exports = {
  generateId
};
