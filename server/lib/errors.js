/**
 * 统一错误类型。业务层只抛 ApiError，路由层负责转成 HTTP 响应。
 */

const STATUS_BY_CODE = {
  VALIDATION: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PATH_INVALID: 400,
  UNSUPPORTED: 415,
  UPSTREAM: 502,
  INTERNAL: 500,
};

export class ApiError extends Error {
  /**
   * @param {keyof typeof STATUS_BY_CODE} code
   * @param {string} message
   * @param {number} [status]
   */
  constructor(code, message, status) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status || STATUS_BY_CODE[code] || 500;
  }

  static validation(message) {
    return new ApiError('VALIDATION', message);
  }

  static notFound(message = '资源不存在') {
    return new ApiError('NOT_FOUND', message);
  }

  static conflict(message) {
    return new ApiError('CONFLICT', message);
  }

  static pathInvalid(message = '路径不可用') {
    return new ApiError('PATH_INVALID', message);
  }

  /** 外部服务（模型接口、Danbooru 等）返回错误 */
  static upstream(message) {
    return new ApiError('UPSTREAM', message);
  }


}

/** 把任意异常收敛为 ApiError；未知错误不泄漏原始信息 */
export function toApiError(err) {
  if (err instanceof ApiError) return err;
  return new ApiError('INTERNAL', '服务器内部错误');
}

export { STATUS_BY_CODE };
