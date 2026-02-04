class LTRModel {
  async load() {
    return true;
  }

  async predict(featuresBatch) {
    return featuresBatch.map(() => 0);
  }
}

module.exports = LTRModel;
