import { api, send, el, money } from "/assets/shared.js";
document.querySelector("#open-menu").addEventListener("submit", (e) => {
  e.preventDefault();
  location.assign(
    "/" + encodeURIComponent(document.querySelector("#slug").value),
  );
});
let contactSending = false;
document.querySelector("#contact").onsubmit = async (e) => {
  e.preventDefault();
  if (contactSending) return;
  contactSending = true;
  const f = e.target,
    b = f.querySelector("button"),
    out = document.querySelector("#contact-result");
  b.disabled = true;
  out.textContent = "Enviando seu interesse…";
  let popup;
  try {
    popup = window.open("about:blank", "_blank");
    if (popup) popup.opener = null;
  } catch {
    // O link de confirmação também funciona quando o navegador bloqueia a janela.
  }
  try {
    const d = Object.fromEntries(new FormData(f));
    d.consentimento = f.elements.consentimento.checked;
    const result = await api("public/contato", send("POST", d));
    const link = el("a", "Abrir WhatsApp da Menuza →");
    link.href = result.whatsapp_url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    out.replaceChildren(
      el(
        "span",
        "Interesse registrado. Confira a mensagem no WhatsApp e confirme o envio. ",
      ),
      link,
    );
    if (popup) {
      try {
        popup.location.href = result.whatsapp_url;
      } catch {
        // O interesse já foi registrado; mantenha o link para abertura manual.
      }
    }
  } catch (e) {
    if (popup) {
      try {
        popup.close();
      } catch {}
    }
    out.textContent =
      "Não foi possível concluir o envio. " +
      (e.status ? e.message : "Verifique sua conexão e tente novamente.");
  } finally {
    contactSending = false;
    b.disabled = false;
  }
};

try {
  const plans = await api("public/planos"),
    root = document.querySelector("#plans");
  root.replaceChildren();
  for (const p of plans) {
    const card = el("article");
    card.append(
      el("h3", p.nome),
      el(
        "p",
        "Cardápio próprio, categorias e gestão de pedidos pelo navegador",
        "help",
      ),
      el("strong", money(p.preco) + "/mês", "plan-price"),
      el(
        "p",
        p.limite_produtos
          ? `Até ${p.limite_produtos} produtos ativos`
          : "Produtos sem limite contratado",
      ),
      el(
        "p",
        p.limite_pedidos_mes
          ? `Até ${p.limite_pedidos_mes} pedidos por mês`
          : "Pedidos sem limite contratado",
      ),
      el("p", "Painel, entrega ou retirada e mensagem para WhatsApp"),
    );
    if (p.adicionais)
      card.append(
        el(
          "p",
          "Mais opções de venda: grupos de sabores e adicionais com preço e seleção mínima/máxima",
        ),
      );
    if (p.personalizacao)
      card.append(
        el("p", "Sua marca em destaque: logo, banner e cor pelo painel"),
      );
    const same = plans.some(
      (other) =>
        other.id !== p.id &&
        [
          "limite_produtos",
          "limite_pedidos_mes",
          "adicionais",
          "personalizacao",
        ].every((key) => other[key] === p[key]),
    );
    if (same)
      card.append(
        el(
          "p",
          "Recursos equivalentes a outro plano listado. Consulte as condições comerciais antes de contratar.",
          "help",
        ),
      );
    const link = el("a", "Conversar sobre este plano →", "primary");
    link.addEventListener("click", () => {
      document.querySelector('#contact [name="mensagem"]').value =
        `Tenho interesse no plano ${p.nome} (${money(p.preco)}/mês).`;
    });
    link.href = "#contato";
    card.append(link);
    root.append(card);
  }
  if (!plans.length)
    root.append(el("p", "Consulte os planos pelo formulário de contato."));
} catch {
  document.querySelector("#plans").textContent =
    "Consulte os planos pelo formulário de contato.";
}
