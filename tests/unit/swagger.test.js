describe('OpenAPI spec', () => {
  test('every route file parses and every endpoint is documented', () => {
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'info').mockImplementation(() => {});
    let spec;
    jest.isolateModules(() => {
      spec = require('../../src/docs/swagger');
    });
    expect(errors).not.toHaveBeenCalled();
    expect(Object.keys(spec.paths).sort()).toEqual([
      '/auth/login',
      '/auth/me',
      '/auth/signup',
      '/bookings',
      '/bookings/{id}',
      '/bookings/{id}/cancel',
      '/centres',
      '/centres/{centreId}/tests',
      '/centres/{centreId}/tests/{testId}',
      '/centres/{id}',
      '/payments',
      '/payments/webhook',
      '/payments/{id}',
      '/tests',
    ]);
    jest.restoreAllMocks();
  });
});
