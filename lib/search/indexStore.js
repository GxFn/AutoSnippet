const fs = require('fs');
const path = require('path');
const paths = require('../infrastructure/config/Paths.js');

function getIndexPath(projectRoot) {
  const base = paths.getProjectInternalDataPath(projectRoot);
  return path.join(base, 'search', 'index.json');
}

function saveIndex(projectRoot, data) {
  const filePath = getIndexPath(projectRoot);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  return filePath;
}

function loadIndex(projectRoot) {
  const filePath = getIndexPath(projectRoot);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

module.exports = {
  getIndexPath,
  saveIndex,
  loadIndex
};
