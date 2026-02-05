function envelope({ success, data = null, message = '', meta = {}, errorCode = null }) {
  const respTime = typeof meta.responseTimeMs === 'number' ? meta.responseTimeMs : undefined;
  const tool = typeof meta.tool === 'string' ? meta.tool : undefined;
  const source = typeof meta.source === 'string' ? meta.source : undefined;
  const version = typeof meta.version === 'string' ? meta.version : '1.0.0';
  const out = {
  success: Boolean(success),
  errorCode: errorCode || null,
  message: message || '',
  data: data,
  meta: {
    ...(tool ? { tool } : {}),
    version,
    ...(respTime != null ? { responseTimeMs: respTime } : {}),
    ...(source ? { source } : {})
  }
  };
  return out;
}

module.exports = { envelope };
