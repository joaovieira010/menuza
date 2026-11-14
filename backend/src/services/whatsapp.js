// A mesma validação é usada no cadastro, checkout e geração de links.
function normalizePhone(value) {
  const digits = String(value ?? "").replace(/[\s()+.-]/g, "");
  if (!/^(55)?[1-9][0-9](?:9[0-9]{8}|[2-5][0-9]{7})$/.test(digits)) {
    const error = new Error("Telefone brasileiro inválido");
    error.status = 400;
    throw error;
  }
  return digits.length >= 12 ? digits : "55" + digits;
}
function whatsappUrl(phone, message) {
  return `https://wa.me/${normalizePhone(phone)}?text=${encodeURIComponent(message)}`;
}
function statusMessage(order) {
  const name = order.cliente_nome.trim().split(/\s+/)[0];
  const number = String(order.numero).padStart(6, "0");
  const greeting = `🔔 Olá, ${name}!`;
  const texts = {
    confirmado: `${greeting}\n\nRecebemos seu pedido #${number}!\n\nObrigado por comprar conosco. ❤️`,
    em_preparacao: `${greeting}\n\nSeu pedido #${number} está em preparação!\n\nObrigado pela preferência! ❤️`,
    pronto:
      order.modalidade === "retirada"
        ? `${greeting}\n\nSeu pedido #${number} está pronto para retirada!\n\nPode vir buscar. Agradecemos a preferência! ❤️`
        : `${greeting}\n\nSeu pedido #${number} está pronto!\n\nObrigado por comprar conosco. ❤️`,
    saiu_para_entrega: `🛵 Olá, ${name}!\n\nSeu pedido #${number} saiu para entrega!\n\nEm breve estará chegando até você.\n\nObrigado pela preferência! ❤️`,
    concluido: `${greeting}\n\nSeu pedido #${number} foi concluído!\n\nObrigado por comprar conosco. ❤️`,
    cancelado: `Olá, ${name}.\n\nInformamos que seu pedido #${number} foi cancelado.\n\nEm caso de dúvidas, entre em contato com a loja.`,
  };
  return texts[order.status] || null;
}
function contactMessage(d) {
  return [
    "Olá! Quero a Menuza para meu estabelecimento.",
    "",
    `Nome: ${d.nome}`,
    `Estabelecimento: ${d.estabelecimento}`,
    ...(d.tipo_negocio ? [`Tipo de negócio: ${d.tipo_negocio}`] : []),
    `Telefone: ${d.telefone}`,
    `E-mail: ${d.email}`,
    ...(d.cidade ? [`Cidade: ${d.cidade}`] : []),
    ...(d.mensagem ? [`Interesse / observações: ${d.mensagem}`] : []),
  ].join("\n");
}
module.exports = { normalizePhone, whatsappUrl, statusMessage, contactMessage };
