/* QA local: cria um pedido fictício no banco configurado. Nunca acessa o WhatsApp externo. */
require("dotenv").config({
  path: require("node:path").resolve(__dirname, "../.env"),
  quiet: true,
});
const { chromium } = require("playwright-core");
const assert = require("node:assert/strict");
async function main() {
  const origin = process.env.APP_ORIGIN || "http://localhost:3000";
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
      }),
      errors = [];
    await context.route("https://wa.me/**", (r) =>
      r.fulfill({
        status: 200,
        contentType: "text/plain",
        body: "WhatsApp interceptado no teste. Nenhuma mensagem enviada.",
      }),
    );
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(origin + "/hamburgueria-demo");
    await page
      .getByRole("heading", { name: "Hamburguer Demo", exact: true })
      .waitFor();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      "Layout mobile sem rolagem lateral",
    );
    await page.screenshot({
      path: "/tmp/menuza-cardapio-mobile.png",
      fullPage: true,
    });
    await page
      .getByRole("button", { name: /Personalizar Burger da casa/ })
      .click();
    await page.getByRole("checkbox").first().check();
    await page
      .getByLabel("Observação deste item")
      .fill("Sem cebola • teste de navegador");
    await page.getByRole("button", { name: /Adicionar ao pedido/ }).click();
    await page.reload();
    await page.getByRole("button", { name: /Ver meu pedido/ }).click();
    await page.getByRole("button", { name: "+", exact: true }).click();
    await page
      .getByRole("button", { name: /Continuar para finalizar/ })
      .click();
    await page.getByLabel("Seu nome").fill("Cliente QA navegador");
    await page.getByLabel("Telefone com DDD").fill("11988887777");
    await page.getByLabel("Rua", { exact: true }).fill("Rua de Teste");
    await page.getByLabel("Número", { exact: true }).fill("123");
    await page.getByLabel("Bairro", { exact: true }).fill("Centro");
    await page.getByLabel("Forma de pagamento").selectOption("dinheiro");
    await page.getByLabel("Troco para (R$)").fill("100,00");
    await page
      .getByLabel("Observações", { exact: true })
      .fill("Pedido fictício de verificação.");
    const saved = page.waitForResponse(
      (r) => r.url().endsWith("/pedidos") && r.request().method() === "POST",
    );
    const popupPromise = context.waitForEvent("page");
    await page.getByRole("button", { name: /Confirmar e ir para/ }).click();
    const response = await saved,
      order = await response.json();
    assert.equal(response.status(), 201);
    assert.equal(order.total, 7080);
    await page.getByRole("heading", { name: /salvo!/ }).waitFor();
    const popup = await popupPromise;
    await popup.waitForLoadState();
    assert.match(popup.url(), /^https:\/\/wa.me\//);
    await popup.close();
    const admin = await context.newPage();
    admin.on("pageerror", (e) => errors.push(e.message));
    await admin.setViewportSize({ width: 1440, height: 1000 });
    await admin.goto(origin + "/admin");
    await admin
      .getByLabel("E-mail", { exact: true })
      .fill("admin@hamburguer.demo");
    await admin
      .getByLabel("Senha", { exact: true })
      .fill(process.env.SEED_ADMIN_PASSWORD);
    await admin.getByRole("button", { name: /Entrar no painel/ }).click();
    await admin
      .getByRole("heading", { name: "Visão geral", exact: true })
      .waitFor();
    await admin.screenshot({
      path: "/tmp/menuza-dashboard.png",
      fullPage: true,
    });
    await admin.getByRole("button", { name: "Pedidos", exact: true }).click();
    const number = "#" + String(order.numero).padStart(6, "0");
    let card = admin
      .locator("article")
      .filter({
        has: admin.getByRole("heading", { name: number, exact: true }),
      });
    await card.waitFor();
    for (const name of [
      "Confirmado →",
      "Em preparação →",
      "Saiu para entrega →",
      "Concluído →",
    ]) {
      await card.getByRole("button", { name, exact: true }).click();
      // A mensagem de sucesso pode ser a da etapa anterior: aguarde o status deste pedido.
      await card
        .locator(".badge")
        .filter({ hasText: new RegExp("^" + name.replace(" →", "") + "$") })
        .waitFor();
    }
    assert.equal(await card.locator(".badge").textContent(), "Concluído");
    await admin.screenshot({ path: "/tmp/menuza-pedidos.png", fullPage: true });
    await admin.getByRole("button", { name: "Produtos", exact: true }).click();
    await admin
      .getByRole("button", { name: "Adicionar", exact: false })
      .click();
    const editor = admin.locator("#editor");
    await editor
      .getByLabel("Nome", { exact: true })
      .fill("Produto QA navegador");
    await editor.getByLabel("Preço em reais (ex.: 28,90)").fill("12,50");
    await editor
      .locator("input[type=file]")
      .setInputFiles({
        name: "qa.png",
        mimeType: "image/png",
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRfoAAAAASUVORK5CYII=",
          "base64",
        ),
      });
    await editor.getByText("Imagem enviada. Salve para aplicar.").waitFor();
    await editor.getByRole("button", { name: "Salvar", exact: true }).click();
    await admin
      .getByRole("status")
      .filter({ hasText: "Alterações salvas." })
      .waitFor();
    const product = admin
      .locator(".record")
      .filter({
        has: admin.getByText("Produto QA navegador", { exact: true }),
      });
    await product.getByRole("button", { name: "Editar", exact: true }).click();
    await editor
      .getByLabel("Nome", { exact: true })
      .fill("Produto QA atualizado");
    await editor.getByRole("button", { name: "Salvar", exact: true }).click();
    await admin
      .getByRole("status")
      .filter({ hasText: "Alterações salvas." })
      .waitFor();
    admin.once("dialog", (d) => d.accept());
    await admin
      .locator(".record")
      .filter({
        has: admin.getByText("Produto QA atualizado", { exact: true }),
      })
      .getByRole("button", { name: "Desativar" })
      .click();
    await admin
      .getByRole("status")
      .filter({ hasText: "Registro desativado." })
      .waitFor();
    await admin
      .getByRole("button", { name: "Minha loja", exact: true })
      .click();
    await admin.getByLabel("Nome da loja", { exact: true }).waitFor();
    await admin.getByRole("button", { name: "Salvar configurações" }).click();
    await admin
      .getByRole("status")
      .filter({ hasText: "Configurações salvas." })
      .waitFor();
    await admin.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await admin.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      "Painel mobile sem rolagem lateral",
    );
    await page.goto(origin + "/doces-demo");
    await page
      .getByRole("heading", { name: "Doces Demo", exact: true })
      .waitFor();
    assert.equal(
      await page.locator("#cart-open").isVisible(),
      false,
      "Carrinho separado por loja",
    );
    assert.equal(
      await page.getByRole("button", { name: /Personalizar Burger/ }).count(),
      0,
    );
    await admin
      .getByRole("button", { name: "Sair da conta", exact: true })
      .click();
    await admin
      .getByRole("heading", { name: "Vamos cuidar da loja?" })
      .waitFor();
    assert.deepEqual(errors, []);
    console.log(
      "Chrome OK: mobile, persistência, adicionais, checkout, WhatsApp interceptado, painel, status, upload, CRUD, configurações e logout. Pedido de QA nº " +
        order.numero +
        ".",
    );
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
