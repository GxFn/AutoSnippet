/**
 * 验证相关错误类
 */

const BaseError = require('./BaseError');

/**
 * 验证错误
 */
class ValidationError extends BaseError {
  constructor(message, details = {}) {
  super(message, 'VALIDATION_ERROR', details);
  Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

/**
 * 必填字段缺失
 */
class RequiredFieldError extends ValidationError {
  constructor(fieldName) {
  super(
    `Required field '${fieldName}' is missing`,
    { fieldName }
  );
  this.code = 'REQUIRED_FIELD';
  Object.setPrototypeOf(this, RequiredFieldError.prototype);
  }
}

/**
 * 字段类型错误
 */
class FieldTypeError extends ValidationError {
  constructor(fieldName, expectedType, actualType) {
  super(
    `Field '${fieldName}' should be ${expectedType}, got ${actualType}`,
    { fieldName, expectedType, actualType }
  );
  this.code = 'FIELD_TYPE_ERROR';
  Object.setPrototypeOf(this, FieldTypeError.prototype);
  }
}

module.exports = {
  ValidationError,
  RequiredFieldError,
  FieldTypeError
};
