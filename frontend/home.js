document.querySelector("#open-menu").addEventListener("submit", (e) => {
  e.preventDefault();
  location.assign(
    "/" + encodeURIComponent(document.querySelector("#slug").value),
  );
});
