(function () {
  function applyTicketTokenTheme(darkMode) {
    document.documentElement.classList.toggle("dark", Boolean(darkMode));

    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) {
      themeColor.content = darkMode ? "#121212" : "#ffffff";
    }
  }

  window.applyTicketTokenTheme = applyTicketTokenTheme;

  try {
    const settings = JSON.parse(
      localStorage.getItem("invitation_settings") || "{}"
    );
    applyTicketTokenTheme(Boolean(settings.darkMode));
  } catch {
    applyTicketTokenTheme(false);
  }
})();
