import {
  el,
  button,
  label,
  input,
  api,
  send,
  image,
  money,
  decimalToCents,
} from "/assets/shared.js";
const $ = (s) => document.querySelector(s),
  slug = decodeURIComponent(location.pathname.split("/")[1]),
  key = "menuza:cart:" + slug;
let menu,
  cart = [],
  activeCategory = "",
  productQuantity = 1,
  submitting = false;
let appliedCoupon = null,
  couponRequest = null,
  couponNeedsReview = false;
const notice = (text) => {
  $("#notice").textContent = text;
};
function close(id) {
  $("#" + id).close();
}
for (const b of document.querySelectorAll("[data-close]"))
  b.addEventListener("click", () => close(b.dataset.close));
for (const d of document.querySelectorAll("dialog"))
  d.addEventListener("click", (e) => {
    if (e.target === d) {
      const r = d.getBoundingClientRect();
      if (
        e.clientX < r.left ||
        e.clientX > r.right ||
        e.clientY < r.top ||
        e.clientY > r.bottom
      )
        d.close();
    }
  });
function persist() {
  resetCoupon();
  try {
    localStorage.setItem(key, JSON.stringify(cart));
  } catch {
    notice(
      "Seu navegador não permitiu salvar o carrinho. Mantenha esta página aberta.",
    );
  }
  updateCart();
}
function current(item) {
  return menu.produtos.find((p) => p.id === item.produto_id);
}
function productGroups(product, categoryId) {
  return product.grupos_por_categoria?.[categoryId] ?? product.grupos;
}
function unit(item) {
  const p = current(item);
  return p
    ? p.preco +
        item.adicionais.reduce(
          (n, id) =>
            n +
            (productGroups(p, item.categoria_id)
              .flatMap((g) => g.adicionais)
              .find((a) => a.id === id)?.preco || 0),
          0,
        )
    : 0;
}
function subtotal() {
  return cart.reduce((n, i) => n + unit(i) * i.quantidade, 0);
}
function updateCart() {
  const n = cart.reduce((n, i) => n + i.quantidade, 0);
  $("#cart-open").hidden = !n;
  $("#cart-count").textContent = n;
  $("#cart-total").textContent = money(subtotal());
}
function totals(
  modality = menu.loja.entrega_ativa === false ? "retirada" : "entrega",
  quote = null,
) {
  const box = el("div", "", "totals"),
    fee =
      quote?.taxa_entrega ??
      (modality === "entrega" ? menu.loja.taxa_entrega : 0),
    itemsTotal = quote?.subtotal ?? subtotal();
  for (const [name, value] of [
    ["Subtotal", money(itemsTotal)],
    ["Taxa de entrega", money(fee)],
    ...(quote
      ? [
          ["Cupom", quote.cupom_codigo],
          ["Desconto", "- " + money(quote.desconto)],
        ]
      : []),
    ["Total", money(quote?.total ?? itemsTotal + fee)],
  ]) {
    const row = el("div", null, "total-row");
    row.append(el("span", name), el("span", value));
    box.append(row);
  }
  return box;
}
function showStore() {
  const s = menu.loja;
  document.title = s.nome + " • Menuza";
  if (/^#[\da-f]{6}$/i.test(s.cor_principal)) {
    document.documentElement.style.setProperty(
      "--cor-principal",
      s.cor_principal,
    );
    const rgb = s.cor_principal
      .slice(1)
      .match(/../g)
      .map((v) => parseInt(v, 16) / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    const lum = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
    document.documentElement.style.setProperty(
      "--on-brand",
      lum > 0.179 ? "#1C1917" : "#fff",
    );
  }
  const copy = el("div", null, "store-copy"),
    title = el("h1", s.nome),
    meta = el("div", null, "store-meta");
  meta.append(
    el(
      "span",
      s.aberto ? "● Aberto agora" : "● Fechado",
      s.aberto ? "badge open" : "badge closed",
    ),
    el(
      "span",
      s.entrega_ativa !== false
        ? s.retirada_ativa !== false
          ? "Entrega e retirada"
          : "Entrega"
        : "Retirada no estabelecimento",
    ),
  );
  if (s.entrega_ativa !== false)
    meta.append(el("span", "Entrega " + money(s.taxa_entrega)));
  copy.append(
    title,
    el("p", s.descricao),
    meta,
    el("span", s.horarios, "hours"),
  );
  $("#store").replaceChildren(
    image(s.logo_url, "Logo de " + s.nome, "logo"),
    copy,
  );
  if (s.banner_url)
    $("#store").before(
      image(s.banner_url, "Banner de " + s.nome, "store-banner"),
    );
  if (!s.aberto)
    notice(
      "A loja está fechada. Você pode consultar o cardápio e preparar seu carrinho.",
    );
}
function categories() {
  const nav = $("#categories");
  nav.replaceChildren();
  for (const [id, name] of [
    ["", "Tudo"],
    ...menu.categorias.map((c) => [c.id, c.nome]),
  ])
    nav.append(
      button(
        name,
        () => {
          activeCategory = id;
          categories();
          renderProducts();
        },
        activeCategory === id ? "ativa" : "",
      ),
    );
}
function renderProducts() {
  const root = $("#products"),
    query = $("#busca").value.toLocaleLowerCase("pt-BR");
  root.replaceChildren();
  let count = 0;
  for (const c of menu.categorias) {
    if (activeCategory && activeCategory !== c.id) continue;
    const products = menu.produtos.filter(
      (p) =>
        (p.categoria_ids ?? [p.categoria_id]).includes(c.id) &&
        (p.nome + " " + p.descricao).toLocaleLowerCase("pt-BR").includes(query),
    );
    if (!products.length) continue;
    count += products.length;
    const section = el("section", null, "category-section"),
      heading = el("div", null, "category-heading"),
      grid = el("div", null, "product-grid");
    heading.append(el("h2", c.nome), el("span", products.length + " opções"));
    for (const p of products) {
      const card = button("", () => openProduct(p, c.id), "product-card"),
        copy = el("div"),
        thumb = el("div", null, "product-thumb");
      card.setAttribute(
        "aria-label",
        `Personalizar ${p.nome}, ${money(p.preco)}`,
      );
      copy.append(
        el("h3", p.nome),
        el("p", p.descricao),
        el("span", money(p.preco), "price"),
      );
      thumb.append(
        image(p.imagem_url, p.nome, "product-image"),
        el("span", "+", "add-dot"),
      );
      card.append(copy, thumb);
      grid.append(card);
    }
    section.append(heading, grid);
    root.append(section);
  }
  if (!count)
    root.append(
      el("p", "Nenhum produto encontrado. Tente outra busca.", "muted"),
    );
}
function openProduct(p, categoryId) {
  const d = $("#product-content");
  const groups = productGroups(p, categoryId);
  d.replaceChildren();
  productQuantity = 1;
  const selected = new Set(),
    head = el("div", null, "dialog-head"),
    title = el("h2", p.nome);
  title.id = "product-title";
  head.append(
    title,
    button("✕", () => close("product-dialog")),
  );
  d.append(
    head,
    image(p.imagem_url, p.nome, "hero-image"),
    el("p", p.descricao, "muted"),
    el("strong", money(p.preco), "price"),
  );
  const error = el("p", null, "error");
  error.setAttribute("role", "alert");
  const obs = input("observacao");
  obs.maxLength = 500;
  const quantity = el("strong", "1"),
    add = button(
      "",
      () => {
        for (const g of groups) {
          const count = g.adicionais.filter((a) => selected.has(a.id)).length;
          if (count < g.minimo || count > g.maximo) {
            error.textContent = `Em ${g.nome}, escolha entre ${g.minimo} e ${g.maximo}.`;
            return;
          }
        }
        if (cart.length >= 50) {
          error.textContent = "Limite de 50 itens diferentes por pedido.";
          return;
        }
        cart.push({
          produto_id: p.id,
          categoria_id: categoryId,
          quantidade: productQuantity,
          adicionais: [...selected],
          observacao: obs.value.trim(),
        });
        persist();
        close("product-dialog");
      },
      "primary wide",
    );
  function price() {
    add.textContent =
      "Adicionar ao pedido · " +
      money(
        (p.preco +
          groups
            .flatMap((g) => g.adicionais)
            .filter((a) => selected.has(a.id))
            .reduce((n, a) => n + a.preco, 0)) *
          productQuantity,
      );
  }
  for (const g of groups) {
    const group = el("fieldset", null, "extra-group");
    group.append(
      el("legend", g.nome),
      el("p", `Escolha de ${g.minimo} a ${g.maximo} opções`, "muted"),
    );
    for (const a of g.adicionais) {
      const check = input("extra", "checkbox");
      check.value = a.id;
      check.addEventListener("change", () => {
        if (check.checked) selected.add(a.id);
        else selected.delete(a.id);
        price();
      });
      const row = el("label", null, "extra-option");
      row.append(check, el("span", a.nome), el("small", "+ " + money(a.preco)));
      group.append(row);
    }
    d.append(group);
  }
  const stepper = el("div", null, "stepper");
  stepper.append(
    button("−", () => {
      productQuantity = Math.max(1, productQuantity - 1);
      quantity.textContent = productQuantity;
      price();
    }),
    quantity,
    button("+", () => {
      productQuantity = Math.min(99, productQuantity + 1);
      quantity.textContent = productQuantity;
      price();
    }),
  );
  d.append(label("Observação deste item", obs), stepper, error, add);
  price();
  $("#product-dialog").showModal();
}
function showCart() {
  const root = $("#cart-content");
  root.replaceChildren();
  if (!cart.length) {
    root.append(el("p", "Seu carrinho está vazio. Escolha algo no cardápio."));
    return;
  }
  cart.forEach((i, index) => {
    const p = current(i),
      row = el("div", null, "cart-item"),
      top = el("div", null, "cart-item-top");
    top.append(
      el("strong", p.nome),
      el("strong", money(unit(i) * i.quantidade)),
    );
    const extras = productGroups(p, i.categoria_id)
      .flatMap((g) => g.adicionais)
      .filter((a) => i.adicionais.includes(a.id))
      .map((a) => a.nome);
    row.append(
      top,
      el("p", [extras.join(", "), i.observacao].filter(Boolean).join("\n")),
    );
    const bottom = el("div", null, "cart-item-bottom"),
      stepper = el("div", null, "stepper");
    stepper.append(
      button("−", () => {
        if (i.quantidade > 1) i.quantidade--;
        else cart.splice(index, 1);
        persist();
        showCart();
      }),
      el("strong", i.quantidade),
      button("+", () => {
        i.quantidade = Math.min(99, i.quantidade + 1);
        persist();
        showCart();
      }),
    );
    bottom.append(
      stepper,
      button(
        "Remover",
        () => {
          cart.splice(index, 1);
          persist();
          showCart();
        },
        "link-button",
      ),
    );
    row.append(bottom);
    root.append(row);
  });
  root.append(
    totals(),
    button(
      menu.loja.aberto ? "Continuar para finalizar →" : "A loja está fechada",
      () => {
        if (!menu.loja.aberto) return;
        close("cart-dialog");
        $("#checkout").hidden = false;
        $("#success").hidden = true;
        $("#checkout-error").textContent = "";
        configureModalities();
        renderCheckout();
        $("#checkout-dialog").showModal();
      },
      "primary wide",
    ),
  );
}
$("#cart-open").addEventListener("click", () => {
  showCart();
  $("#cart-dialog").showModal();
});
$("#busca").addEventListener("input", renderProducts);
const form = $("#checkout");
const couponInput = $("#coupon-code"),
  couponApply = $("#coupon-apply"),
  couponRemove = $("#coupon-remove"),
  couponError = $("#coupon-error"),
  confirmOrder = $("#confirm-order");

function resetCoupon() {
  couponRequest?.abort();
  couponRequest = appliedCoupon = null;
  couponNeedsReview = false;
  couponInput.value = "";
  couponError.textContent = "";
  renderCheckout();
}

function renderCheckout() {
  checkoutTotal(appliedCoupon);
  couponInput.readOnly = submitting || !!couponRequest || !!appliedCoupon;
  couponApply.disabled = couponInput.readOnly;
  couponRemove.hidden = !appliedCoupon && !couponNeedsReview;
  couponRemove.disabled = submitting;
  confirmOrder.disabled = submitting || !!couponRequest || couponNeedsReview;
}

async function applyCoupon() {
  const code = couponInput.value.trim();
  if (submitting || !cart.length) return;
  if (!code) {
    couponError.textContent = "Informe o código do cupom.";
    couponInput.focus();
    return;
  }
  couponRequest?.abort();
  const request = new AbortController();
  couponRequest = request;
  couponNeedsReview ||= !!appliedCoupon;
  appliedCoupon = null;
  couponError.textContent = "";
  renderCheckout();
  try {
    const quote = await api(encodeURIComponent(slug) + "/cupons/validar", {
      ...send("POST", {
        cupom_codigo: code,
        modalidade: form.elements.modalidade.value,
        itens: cart,
      }),
      signal: request.signal,
    });
    if (couponRequest !== request) return;
    appliedCoupon = quote;
    couponInput.value = quote.cupom_codigo;
    couponNeedsReview = false;
  } catch (error) {
    if (couponRequest === request) couponError.textContent = error.message;
  } finally {
    if (couponRequest === request) {
      couponRequest = null;
      renderCheckout();
    }
  }
}

couponApply.addEventListener("click", applyCoupon);
couponRemove.addEventListener("click", () => {
  resetCoupon();
  couponInput.focus();
});
couponInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  if (!couponApply.disabled) applyCoupon();
});
function configureModalities() {
  const select = form.elements.modalidade;
  const previous = select.value;
  select.replaceChildren();
  for (const [value, title] of [
    ["entrega", "Entrega"],
    ["retirada", "Retirada no estabelecimento"],
  ]) {
    if (menu.loja[`${value}_ativa`] === false) continue;
    const option = el("option", title);
    option.value = value;
    select.append(option);
  }
  if ([...select.options].some((option) => option.value === previous))
    select.value = previous;
}
function checkoutTotal(quote = null) {
  const mode = form.elements.modalidade.value;
  $("#address").hidden = mode !== "entrega";
  for (const name of ["rua", "numero", "bairro"])
    form.elements[name].required = mode === "entrega";
  $("#checkout-total").replaceChildren(totals(mode, quote));
}
form.elements.modalidade.addEventListener("change", () => {
  if (appliedCoupon || couponRequest || couponNeedsReview) applyCoupon();
  else renderCheckout();
});
form.elements.forma_pagamento.addEventListener("change", () => {
  $("#change-label").hidden =
    form.elements.forma_pagamento.value !== "dinheiro";
  if ($("#change-label").hidden) form.elements.troco_para.value = "";
});
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (confirmOrder.disabled || !cart.length) return;
  submitting = true;
  renderCheckout();
  $("#checkout-error").textContent = "";
  try {
    const f = Object.fromEntries(new FormData(form));
    if (
      !["entrega", "retirada"].includes(f.modalidade) ||
      menu.loja[`${f.modalidade}_ativa`] === false
    )
      throw new Error("Selecione uma modalidade de recebimento disponível.");
    form.elements.modalidade.disabled = true;
    const data = {
      cliente: { nome: f.nome, telefone: f.telefone },
      modalidade: f.modalidade,
      forma_pagamento: f.forma_pagamento,
      troco_para: f.troco_para ? decimalToCents(f.troco_para) : null,
      observacoes: f.observacoes,
      endereco: {
        rua: f.rua,
        numero: f.numero,
        bairro: f.bairro,
        complemento: f.complemento,
        referencia: f.referencia,
      },
      itens: cart,
      ...(appliedCoupon && { cupom_codigo: appliedCoupon.cupom_codigo }),
    };
    // Repetir após falha de rede conserva a mesma chave e não duplica a gravação.
    const payload = JSON.stringify(data);
    let pending;
    try {
      pending = JSON.parse(sessionStorage.getItem(key + ":pending") || "null");
    } catch {}
    if (!pending || pending.payload !== payload)
      pending = { payload, id: crypto.randomUUID() };
    try {
      sessionStorage.setItem(key + ":pending", JSON.stringify(pending));
    } catch {}
    data.idempotencia = pending.id;
    const order = await api(
      encodeURIComponent(slug) + "/pedidos",
      send("POST", data),
    );
    try {
      sessionStorage.removeItem(key + ":pending");
    } catch {}
    cart = [];
    persist();
    form.hidden = true;
    const success = $("#success"),
      link = el("a", "Abrir conversa no WhatsApp →", "primary whatsapp-link");
    link.href = order.whatsapp_url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    const copy = el("pre", order.mensagem);
    copy.className = "order-message";
    success.replaceChildren(
      el(
        "h3",
        "Pedido nº " + String(order.numero).padStart(6, "0") + " salvo!",
      ),
      el(
        "p",
        "Total: " +
          money(order.total) +
          ". Envie a mensagem para combinar com a loja.",
      ),
      link,
      copy,
    );
    success.hidden = false;
    // O banco confirmou a gravação. O link permanece disponível se o navegador bloquear a janela.
    window.open(order.whatsapp_url, "_blank", "noopener,noreferrer");
  } catch (e) {
    if (e.code === "cupom_invalido" && appliedCoupon) {
      appliedCoupon = null;
      couponNeedsReview = true;
      couponError.textContent =
        e.message + " Aplique outro cupom ou remova o código para continuar.";
      couponInput.focus();
    } else {
      $("#checkout-error").textContent = e.message;
    }
  } finally {
    submitting = false;
    form.elements.modalidade.disabled = false;
    renderCheckout();
  }
});
try {
  menu = await api(encodeURIComponent(slug) + "/cardapio");
  try {
    const saved = JSON.parse(localStorage.getItem(key) || "[]");
    if (Array.isArray(saved))
      cart = saved.slice(0, 50).filter(
        (i) =>
          i &&
          Number.isInteger(i.quantidade) &&
          i.quantidade > 0 &&
          i.quantidade <= 99 &&
          Array.isArray(i.adicionais) &&
          typeof i.observacao === "string" &&
          i.observacao.length <= 500 &&
          menu.produtos.some(
            (p) =>
              p.id === i.produto_id &&
              (i.categoria_id === undefined ||
                (p.categoria_ids ?? [p.categoria_id]).includes(
                  i.categoria_id,
                )) &&
              i.adicionais.every((id) =>
                productGroups(p, i.categoria_id)
                  .flatMap((g) => g.adicionais)
                  .some((a) => a.id === id),
              ),
          ),
      );
  } catch {
    cart = [];
  }
  configureModalities();
  renderCheckout();
  showStore();
  categories();
  renderProducts();
  updateCart();
} catch (e) {
  document.title =
    e.status === 423
      ? "Estabelecimento indisponível • Menuza"
      : "Cardápio indisponível • Menuza";
  $(".menu-main").replaceChildren(
    el(
      "h1",
      e.status === 423
        ? "Estabelecimento temporariamente indisponível"
        : "Cardápio não encontrado",
    ),
    el("p", e.message),
  );
  $("#store").replaceChildren(el("p", "Menuza · Cardápios digitais"));
  $("#cart-open").hidden = true;
}
