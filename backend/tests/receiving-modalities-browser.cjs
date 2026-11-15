// Navegador com HTML/JS reais e rede totalmente interceptada. Sem banco ou serviços reais.
const { chromium } = require("playwright-core");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const root = path.resolve(__dirname, "../../frontend");
const cases = [
  {
    name: "somente retirada",
    entrega_ativa: false,
    retirada_ativa: true,
    options: ["retirada"],
    mode: "retirada",
  },
  {
    name: "somente entrega",
    entrega_ativa: true,
    retirada_ativa: false,
    options: ["entrega"],
    mode: "entrega",
  },
  {
    name: "ambas, troca para retirada",
    entrega_ativa: true,
    retirada_ativa: true,
    options: ["entrega", "retirada"],
    mode: "retirada",
  },
  {
    name: "catálogo antigo mantém ambas",
    options: ["entrega", "retirada"],
    mode: "entrega",
  },
  {
    name: "entrega desativada após abrir checkout",
    entrega_ativa: true,
    retirada_ativa: true,
    options: ["entrega", "retirada"],
    mode: "entrega",
    rejected: true,
  },
  {
    name: "seleção adulterada bloqueada no cliente",
    entrega_ativa: false,
    retirada_ativa: true,
    options: ["retirada"],
    mode: "retirada",
    tampered: true,
  },
];
async function main() {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    for (const test of cases) {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
      });
      const errors = [],
        submitted = [];
      const loja = {
        id: "700",
        nome: "Loja QA sintética",
        slug: "loja-qa",
        aberto: true,
        whatsapp: "5511999998888",
        taxa_entrega: 500,
        cor_principal: "#C2410C",
        entrega_ativa: test.entrega_ativa,
        retirada_ativa: test.retirada_ativa,
      };
      await context.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== "https://menuza-qa.invalid") return route.abort();
        if (url.pathname === "/api/loja-qa/cardapio")
          return route.fulfill({
            json: {
              loja,
              categorias: [{ id: "10", nome: "Categoria QA" }],
              produtos: [
                {
                  id: "100",
                  categoria_id: "10",
                  nome: "Produto QA",
                  preco: 1000,
                  descricao: "Produto sintético",
                  grupos: [],
                },
              ],
            },
          });
        if (url.pathname === "/api/loja-qa/pedidos") {
          const body = route.request().postDataJSON();
          submitted.push(body);
          if (test.rejected)
            return route.fulfill({
              status: 400,
              json: {
                erro: "Este estabelecimento não está recebendo pedidos de entrega.",
              },
            });
          return route.fulfill({
            status: 201,
            json: {
              numero: 1,
              total: body.modalidade === "entrega" ? 1500 : 1000,
              mensagem: "Pedido QA",
              whatsapp_url: "https://wa.me/5511999998888?text=QA",
            },
          });
        }
        const relative =
          url.pathname === "/loja-qa"
            ? "cardapio/index.html"
            : url.pathname.startsWith("/assets/")
              ? url.pathname.slice(8)
              : null;
        if (!relative || relative.includes("..")) return route.abort();
        const contentType = relative.endsWith(".js")
          ? "application/javascript"
          : relative.endsWith(".css")
            ? "text/css"
            : relative.endsWith(".svg")
              ? "image/svg+xml"
              : "text/html";
        return route.fulfill({
          body: await fs.readFile(path.join(root, relative)),
          contentType,
        });
      });
      const page = await context.newPage();
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto("https://menuza-qa.invalid/loja-qa");
      await page
        .getByRole("heading", { name: loja.nome, exact: true })
        .waitFor();
      if (test.entrega_ativa === false) {
        assert.match(
          await page.locator("#store").innerText(),
          /Retirada no estabelecimento/,
        );
        assert.doesNotMatch(
          await page.locator("#store").innerText(),
          /Entrega R\$/,
        );
      }
      await page
        .getByRole("button", { name: /Personalizar Produto QA/ })
        .click();
      await page.getByRole("button", { name: /Adicionar ao pedido/ }).click();
      await page.getByRole("button", { name: /Ver meu pedido/ }).click();
      if (test.entrega_ativa === false)
        assert.match(
          (await page.locator("#cart-content").innerText()).replaceAll(
            "\u00a0",
            " ",
          ),
          /Total\s+R\$ 10,00/,
        );
      await page
        .getByRole("button", { name: /Continuar para finalizar/ })
        .click();
      const select = page.locator('[name="modalidade"]');
      assert.deepEqual(
        await select
          .locator("option")
          .evaluateAll((options) => options.map((o) => o.value)),
        test.options,
      );
      await select.selectOption(test.mode);
      assert.equal(
        await page.locator("#address").isVisible(),
        test.mode === "entrega",
      );
      assert.equal(
        await page.locator('[name="rua"]').evaluate((e) => e.required),
        test.mode === "entrega",
      );
      const total = (
        await page.locator("#checkout-total").innerText()
      ).replaceAll("\u00a0", " ");
      assert.match(
        total,
        test.mode === "entrega" ? /Total\s+R\$ 15,00/ : /Total\s+R\$ 10,00/,
      );
      await page.getByLabel("Seu nome").fill("Cliente QA");
      await page.getByLabel("Telefone com DDD").fill("11999998888");
      if (test.mode === "entrega") {
        await page.getByRole("button", { name: /Confirmar e ir para/ }).click();
        assert.equal(
          submitted.length,
          0,
          "Endereço vazio não pode ser enviado para entrega",
        );
        await page.getByLabel("Rua", { exact: true }).fill("Rua QA");
        await page.getByLabel("Número", { exact: true }).fill("1");
        await page.getByLabel("Bairro", { exact: true }).fill("Centro");
      }
      if (test.tampered)
        await select.evaluate((e) => {
          const option = new Option("Entrega", "entrega");
          e.append(option);
          e.value = "entrega";
        });
      await page.getByRole("button", { name: /Confirmar e ir para/ }).click();
      if (test.tampered) {
        await page
          .getByText("Selecione uma modalidade de recebimento disponível.")
          .waitFor();
        assert.equal(submitted.length, 0);
      } else if (test.rejected) {
        await page
          .getByText(
            "Este estabelecimento não está recebendo pedidos de entrega.",
          )
          .waitFor();
        assert.equal(await page.locator("#checkout").isVisible(), true);
        assert.equal(await page.locator("#success").isVisible(), false);
        assert.equal(await page.locator("#confirm-order").isEnabled(), true);
      } else {
        await page.getByRole("heading", { name: /salvo!/ }).waitFor();
        assert.equal(submitted.length, 1);
        assert.equal(submitted[0].modalidade, test.mode);
        if (test.mode === "retirada")
          assert.equal(submitted[0].endereco.rua, "");
      }
      assert.deepEqual(errors, []);
      console.log("PASS", test.name);
      await context.close();
    }
    console.log(
      `${cases.length} cenários de navegador passaram; rede e pedidos simulados.`,
    );
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
