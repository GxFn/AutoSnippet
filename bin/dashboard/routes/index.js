const { registerCoreRoutes } = require('./core');
const { registerSearchRoutes } = require('./search');
const { registerCommandsRoutes } = require('./commands');
const { registerExtractRoutes } = require('./extract');
const { registerAiRoutes } = require('./ai');
const { registerSnippetsRoutes } = require('./snippets');
const { registerRecipesRoutes } = require('./recipes');
const { registerGuardRoutes } = require('./guard');
const { registerSpmRoutes } = require('./spm');
const { registerCandidatesRoutes } = require('./candidates');

function registerDashboardRoutes(app, ctx) {
  registerCoreRoutes(app, ctx);
  registerSearchRoutes(app, ctx);
  registerCommandsRoutes(app, ctx);
  registerExtractRoutes(app, ctx);
  registerAiRoutes(app, ctx);
  registerSnippetsRoutes(app, ctx);
  registerRecipesRoutes(app, ctx);
  registerGuardRoutes(app, ctx);
  registerSpmRoutes(app, ctx);
  registerCandidatesRoutes(app, ctx);
}

module.exports = {
  registerDashboardRoutes,
};
