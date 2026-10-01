/*
 * demo.js — entrada automática no modo demonstração.
 *
 * O sistema é usado como vitrine: quem abre o link precisa cair direto no
 * painel, sem passar por tela de login. Em vez de remover a autenticação do
 * backend (o que deixaria o banco aberto), a página entra sozinha com uma
 * conta de demonstração. Todo o resto continua igual: o token é real e o RLS
 * do Supabase segue valendo — a conta demo só enxerga os dados dela.
 *
 * A tela de login continua existindo em /login.html para uso próprio.
 */

window.DEMO = {
  email: "demo@padaria.com",
  senha: "demo1234",
};

(function () {
  "use strict";

  function aviso(texto) {
    var d = document.createElement("div");
    d.setAttribute("role", "alert");
    d.style.cssText =
      "position:fixed;inset:0;z-index:9999;display:flex;align-items:center;" +
      "justify-content:center;padding:24px;background:#fff;color:#1a1a1a;" +
      "font:16px/1.5 system-ui,sans-serif;text-align:center";
    d.innerHTML =
      '<div style="max-width:30rem">' +
      '<p style="font-size:1.1rem;font-weight:600;margin:0 0 .5rem">Demonstração indisponível</p>' +
      '<p style="margin:0;color:#555">' + texto + "</p></div>";
    document.body.appendChild(d);
  }

  function carregarApp() {
    var s = document.createElement("script");
    s.src = "/script.js?v=2";
    document.body.appendChild(s);
  }

  // Entra com a conta demo e guarda o token no mesmo lugar que o login normal
  // usa, para que o resto do sistema funcione sem saber que é demonstração.
  window.entrarDemo = function () {
    return fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: window.DEMO.email, senha: window.DEMO.senha }),
    })
      .then(function (r) {
        if (!r.ok) throw new Error("login demo recusado (" + r.status + ")");
        return r.json();
      })
      .then(function (d) {
        localStorage.setItem("token", d.token);
        localStorage.setItem("nome_padaria", d.nome_padaria);
        return d;
      });
  };

  function iniciar() {
    if (localStorage.getItem("token")) {
      carregarApp();
      return;
    }
    window
      .entrarDemo()
      .then(carregarApp)
      .catch(function (e) {
        aviso(
          "Não foi possível entrar com a conta de demonstração. " +
            "Verifique se o usuário existe no Supabase e se as variáveis " +
            "SUPABASE_URL e SUPABASE_KEY estão configuradas no servidor.<br><br>" +
            '<span style="font-size:.8rem;color:#888">' + e.message + "</span>"
        );
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", iniciar);
  } else {
    iniciar();
  }
})();
