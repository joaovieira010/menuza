/* QA ponta a ponta em PostgreSQL descartável: cria clientes e pagamentos somente no banco _test. */
require("dotenv").config({ path: "backend/.env", quiet: true });
const assert = require("node:assert/strict"),
  crypto = require("node:crypto"),
  bcrypt = require("bcrypt");
const target = process.env.TEST_DATABASE_URL;
if (
  !target ||
  !new URL(target).pathname.endsWith("_test") ||
  target === process.env.DATABASE_URL
)
  throw new Error("Exige TEST_DATABASE_URL separado.");
process.env.DATABASE_URL = target;
process.env.NODE_ENV = "test";
const app = require("../src/app"),
  pool = require("../src/database/pool"),
  env = require("../src/config/env"),
  migrate = require("../src/database/migrate");
const { chromium } = require("playwright-core");
async function main() {
  await migrate();
  const uid = Date.now(),
    email = `browser-owner-${uid}@qa.test`,
    storeEmail = `browser-store-${uid}@qa.test`,
    password = crypto.randomBytes(18).toString("hex"),
    name = "Loja Navegador " + uid;
  await pool.query(
    "INSERT INTO usuarios(email,senha_hash,papel) VALUES($1,$2,'SUPERADMIN')",
    [email, await bcrypt.hash(password, 12)],
  );
  const {
    rows: [dates],
  } = await pool.query(
    "SELECT to_char((now() AT TIME ZONE 'America/Sao_Paulo')::date,'YYYY-MM-DD') AS hoje,to_char((now() AT TIME ZONE 'America/Sao_Paulo')::date+30,'YYYY-MM-DD') AS futuro",
  );
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  env.origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox"],
  });
  const errors = [];
  try {
    const context = await browser.newContext({
      viewport: { width: 1365, height: 900 },
    });
    context.on("page", (p) => p.on("pageerror", (e) => errors.push(e.message)));
    await context.route("https://wa.me/**", (r) =>
      r.fulfill({
        status: 200,
        body: "Interceptado: nenhuma mensagem enviada.",
      }),
    );
    const owner = await context.newPage();
    await owner.goto(env.origin + "/");
    await owner
      .getByRole("heading", {
        name: "Seu negócio merece um cardápio à altura.",
      })
      .waitFor();
    for (const [name, price] of [
      ["Básico", "49,90"],
      ["Profissional", "79,90"],
      ["Completo", "119,90"],
    ]) {
      const card = owner.locator("#plans article").filter({
        has: owner.getByRole("heading", { name, exact: true }),
      });
      await card.waitFor();
      assert.equal(await card.count(), 1);
      assert((await card.textContent()).includes(price));
    }
    await owner.setViewportSize({ width: 390, height: 844 });
    assert(
      await owner.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await owner.screenshot({
      path: "/tmp/menuza-institucional-mobile.png",
      fullPage: true,
    });
    assert.equal(
      await owner
        .getByRole("link", { name: /Experimentar o cardápio/ })
        .count(),
      0,
    );
    const contact = owner.locator("#contact");
    await contact.locator('[name="nome"]').fill("João QA");
    await contact.locator('[name="estabelecimento"]').fill("Negócio QA & café");
    await contact.locator('[name="tipo_negocio"]').fill("Doceria");
    await contact.locator('[name="cidade"]').fill("São José");
    await contact.locator('[name="email"]').fill("lead@qa.test");
    await contact.locator('[name="telefone"]').fill("+55 (48) 98878-0394");
    await contact.locator('[name="mensagem"]').fill("Interesse #piloto");
    await contact.locator('[name="consentimento"]').check();
    const contactPopupPromise = context.waitForEvent("page");
    await contact
      .getByRole("button", { name: "Conversar no WhatsApp →" })
      .click();
    const contactPopup = await contactPopupPromise;
    await contactPopup.waitForURL("https://wa.me/**");
    const leadUrl = new URL(contactPopup.url());
    assert.equal(leadUrl.pathname, "/5548988780394");
    for (const value of [
      "João QA",
      "Negócio QA & café",
      "Doceria",
      "São José",
      "Interesse #piloto",
    ])
      assert(leadUrl.searchParams.get("text").includes(value));
    await contactPopup.close();
    await owner.locator("#contact-result a").waitFor();
    await owner.goto(env.origin + "/superadmin");
    await owner.getByLabel("E-mail", { exact: true }).fill(email);
    await owner.getByLabel("Senha", { exact: true }).fill(password);
    await owner.getByRole("button", { name: /Entrar no painel/ }).click();
    await owner
      .getByRole("heading", { name: "Visão geral", exact: true })
      .waitFor();
    await owner.goto(env.origin + "/superadmin/");
    await owner
      .getByRole("heading", { name: "Próximos vencimentos", exact: true })
      .waitFor();
    assert.equal(await owner.locator("#login-screen").isVisible(), false);
    await owner
      .getByRole("button", { name: "Estabelecimentos", exact: true })
      .click();
    await owner
      .getByRole("button", { name: "Cadastrar estabelecimento", exact: true })
      .click();
    const dialog = owner.locator("#editor");
    await dialog.getByLabel("Nome comercial", { exact: true }).fill(name);
    await dialog
      .getByLabel("Responsável", { exact: true })
      .fill("Responsável Navegador");
    await dialog
      .getByLabel("E-mail de contato", { exact: true })
      .fill(storeEmail);
    await dialog
      .getByLabel("Telefone com DDD", { exact: true })
      .fill("+55 (11) 99999-8888");
    const proPlan = (
      await pool.query("SELECT id FROM planos WHERE nome='Profissional'")
    ).rows[0];
    await dialog.locator('[name="plano_id"]').selectOption(String(proPlan.id));
    assert.equal(
      await dialog
        .getByLabel("Mensalidade contratada (R$)", { exact: true })
        .inputValue(),
      "79.90",
    );
    await dialog
      .getByLabel("Mensalidade contratada (R$)", { exact: true })
      .fill("49,90");
    await dialog
      .getByLabel("Próximo vencimento", { exact: true })
      .fill(dates.futuro);
    await dialog
      .getByLabel("E-mail de acesso do proprietário", { exact: true })
      .fill(storeEmail);
    await dialog
      .getByLabel("Senha inicial (mínimo 12 caracteres)", { exact: true })
      .fill(password);
    const created = owner.waitForResponse(
      (r) =>
        r.url().endsWith("/api/superadmin/lojas") &&
        r.request().method() === "POST",
    );
    await dialog.getByRole("button", { name: "Salvar", exact: true }).click();
    const response = await created;
    assert.equal(response.status(), 201, await response.text());
    const loja = await response.json();
    await dialog.waitFor({ state: "hidden" });
    await owner.getByRole("heading", { name, exact: true }).waitFor();
    assert(
      await owner.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await owner.screenshot({
      path: "/tmp/menuza-superadmin-mobile.png",
      fullPage: true,
    });
    const admin = await context.newPage();
    await admin.goto(env.origin + "/admin");
    await admin.getByLabel("E-mail", { exact: true }).fill(storeEmail);
    await admin.getByLabel("Senha", { exact: true }).fill(password);
    await admin.getByRole("button", { name: /Entrar no painel/ }).click();
    await admin
      .getByRole("heading", { name: "Visão geral", exact: true })
      .waitFor();
    await admin
      .getByRole("button", { name: "Categorias", exact: true })
      .click();
    await admin.getByRole("button", { name: /Adicionar/ }).click();
    await admin
      .locator("#editor")
      .getByLabel("Nome", { exact: true })
      .fill("Lanches QA");
    await admin
      .locator("#editor")
      .getByRole("button", { name: "Salvar", exact: true })
      .click();
    await admin.locator("#editor").waitFor({ state: "hidden" });
    await admin.getByRole("button", { name: "Produtos", exact: true }).click();
    await admin.getByRole("button", { name: /Adicionar/ }).click();
    await admin
      .locator("#editor")
      .getByLabel("Nome", { exact: true })
      .fill("Lanche Navegador");
    await admin
      .getByLabel("Preço em reais (ex.: 28,90)", { exact: true })
      .fill("25,00");
    await admin
      .locator("#editor")
      .getByRole("button", { name: "Salvar", exact: true })
      .click();
    await admin.locator("#editor").waitFor({ state: "hidden" });
    await admin
      .getByRole("button", { name: "Minha loja", exact: true })
      .click();
    await admin
      .getByLabel("WhatsApp com DDD e país", { exact: true })
      .fill("5511999998888");
    await admin
      .getByLabel("Loja aberta para receber pedidos", { exact: true })
      .check();
    await admin
      .getByRole("button", { name: "Salvar configurações", exact: true })
      .click();
    await admin.getByText("Configurações salvas.", { exact: true }).waitFor();
    const customer = await context.newPage();
    await customer.setViewportSize({ width: 390, height: 844 });
    await customer.goto(env.origin + "/" + loja.slug);
    await customer
      .getByRole("button", { name: /Personalizar Lanche Navegador/ })
      .click();
    await customer.getByRole("button", { name: /Adicionar ao pedido/ }).click();
    await customer.getByRole("button", { name: /Ver meu pedido/ }).click();
    await customer
      .getByRole("button", { name: /Continuar para finalizar/ })
      .click();
    await customer
      .getByLabel("Seu nome", { exact: true })
      .fill("Comprador Navegador");
    await customer
      .getByLabel("Telefone com DDD", { exact: true })
      .fill("11988887777");
    await customer.getByLabel("Modalidade").selectOption("retirada");
    const saved = customer.waitForResponse(
      (r) => r.url().endsWith("/pedidos") && r.request().method() === "POST",
    );
    await customer.getByRole("button", { name: /Confirmar e ir para/ }).click();
    const orderResponse = await saved;
    assert.equal(orderResponse.status(), 201, await orderResponse.text());
    const pedido = await orderResponse.json();
    assert.equal(pedido.total, 2500);
    await customer.getByRole("heading", { name: /salvo!/ }).waitFor();
    await admin.getByRole("button", { name: "Pedidos", exact: true }).click();
    await admin
      .getByText("Comprador Navegador", { exact: false })
      .first()
      .waitFor();
    const orderCard = admin.locator("article.order-card").filter({
      has: admin.getByRole("heading", {
        name: "#" + String(pedido.numero).padStart(6, "0"),
        exact: true,
      }),
    });
    for (const [action, badge] of [
      ["Confirmar recebimento", "Pedido recebido"],
      ["Iniciar preparação", "Em preparação"],
      ["Pedido pronto", "Pedido pronto"],
    ]) {
      await orderCard
        .getByRole("button", { name: action, exact: true })
        .click();
      await orderCard
        .locator(".badge")
        .filter({ hasText: new RegExp("^" + badge + "$") })
        .waitFor();
    }
    await orderCard
      .getByText("Mensagem para o cliente", { exact: true })
      .click();
    assert.match(
      await orderCard.locator("pre").textContent(),
      /pronto para retirada!/,
    );
    const popupPromise = context.waitForEvent("page");
    await orderCard
      .getByRole("button", { name: "Abrir WhatsApp do cliente ↗", exact: true })
      .click();
    const notificationPopup = await popupPromise;
    await notificationPopup.waitForURL("https://wa.me/**");
    const notificationUrl = new URL(notificationPopup.url());
    assert.equal(notificationUrl.pathname, "/5511988887777");
    assert.match(
      notificationUrl.searchParams.get("text"),
      /pronto para retirada!/,
    );
    await notificationPopup.close();
    assert(
      await orderCard
        .getByRole("button", { name: "Abertura já solicitada", exact: true })
        .isDisabled(),
    );
    await admin
      .getByRole("button", { name: "↻ Atualizar pedidos", exact: true })
      .click();
    await orderCard
      .getByRole("button", { name: "Abertura já solicitada", exact: true })
      .waitFor();
    assert(
      await orderCard
        .getByRole("button", { name: "Abertura já solicitada", exact: true })
        .isDisabled(),
    );
    await orderCard
      .getByRole("button", { name: "Concluir pedido", exact: true })
      .click();
    await orderCard
      .locator(".badge")
      .filter({ hasText: /^Concluído$/ })
      .waitFor();
    await admin.screenshot({
      path: "/tmp/menuza-saas-pedido.png",
      fullPage: true,
    });
    // Usa data relativa real no PostgreSQL; o acesso precisa bloquear antes do cron.
    await pool.query(
      "UPDATE assinaturas SET vencimento=(now() AT TIME ZONE 'America/Sao_Paulo')::date-7 WHERE estabelecimento_id=$1",
      [loja.id],
    );
    await customer.reload();
    await customer
      .getByRole("heading", {
        name: "Estabelecimento temporariamente indisponível",
        exact: true,
      })
      .waitFor();
    assert(
      await customer.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await customer.screenshot({
      path: "/tmp/menuza-suspensao-mobile.png",
      fullPage: true,
    });
    const card = owner
      .locator("article")
      .filter({ has: owner.getByRole("heading", { name, exact: true }) });
    await card
      .getByRole("button", { name: "Registrar pagamento", exact: true })
      .click();
    await dialog
      .getByLabel("Data do recebimento", { exact: true })
      .fill(dates.hoje);
    await dialog
      .getByLabel("Referência única do comprovante", { exact: true })
      .fill("PIX-NAVEGADOR-" + uid);
    await dialog
      .getByLabel("Próximo vencimento", { exact: true })
      .fill(dates.futuro);
    await dialog
      .getByLabel("Conferi e confirmo o recebimento", { exact: true })
      .check();
    const payment = owner.waitForResponse(
      (r) => r.url().endsWith("/pagamentos") && r.request().method() === "POST",
    );
    await dialog.getByRole("button", { name: "Salvar", exact: true }).click();
    assert.equal((await payment).status(), 201);
    await dialog.waitFor({ state: "hidden" });
    await customer.reload();
    await customer.getByRole("heading", { name, exact: true }).waitFor();
    await owner.setViewportSize({ width: 1365, height: 900 });
    await owner
      .getByRole("button", { name: "Visão geral", exact: true })
      .click();
    await owner
      .getByRole("heading", { name: "Próximos vencimentos", exact: true })
      .waitFor();
    await owner.screenshot({
      path: "/tmp/menuza-superadmin-desktop.png",
      fullPage: true,
    });
    assert.equal(
      (
        await pool.query(
          "SELECT id FROM pedidos WHERE estabelecimento_id=$1 AND id=$2",
          [loja.id, pedido.id],
        )
      ).rowCount,
      1,
    );
    assert.deepEqual(errors, []);
    await owner
      .getByRole("button", { name: "Sair da conta", exact: true })
      .click();
    await owner.getByLabel("E-mail", { exact: true }).waitFor();
    assert.equal(
      (await context.request.get(env.origin + "/api/superadmin/me")).status(),
      401,
    );
    // Sair da plataforma preserva a sessão independente do administrador de loja.
    await admin.reload();
    await admin
      .getByRole("button", { name: "Categorias", exact: true })
      .waitFor();
    console.log(
      "Chrome SaaS OK: institucional mobile, superadmin, cadastro real, categoria, produto, abertura, pedido mobile, painel, status com histórico, WhatsApp do cliente interceptado e abertura única, suspensão sem cron, quitação e reativação. Loja QA " +
        loja.id,
    );
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
