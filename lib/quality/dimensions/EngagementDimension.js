class EngagementDimension {
  constructor(config = {}) {
    this.config = config;
  }

  calculate(candidate, context = {}) {
    const metrics = context.engagement || {};
    const views = Number(metrics.views || 0);
    const clicks = Number(metrics.clicks || 0);
    const ratings = Number(metrics.rating || 0);

    if (views === 0) return 0.5;
    const ctr = clicks / views;
    const ratingScore = ratings ? Math.min(1, ratings / 5) : 0.5;

    return Math.min(1, (ctr * 0.7) + (ratingScore * 0.3));
  }
}

module.exports = EngagementDimension;
