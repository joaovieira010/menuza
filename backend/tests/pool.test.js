process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://unused@127.0.0.1/isolated_test";
process.env.JWT_SECRET =
  "isolated-unit-test-secret-with-at-least-32-characters";
const pool = require("../src/database/pool");
afterAll(() => pool.end());
test("desconexão ociosa é tratada sem encerrar processo nem expor a conexão", () => {
  const log = jest.spyOn(console, "error").mockImplementation(() => {});
  try {
    expect(() =>
      pool.emit("error", new Error("detalhe-privado")),
    ).not.toThrow();
    expect(log).toHaveBeenCalledWith("database.idle_connection_error");
    expect(pool.totalCount).toBe(0);
  } finally {
    log.mockRestore();
  }
});
