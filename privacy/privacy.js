// Theme management
(function() {
  'use strict';

  // Get theme toggle element
  const themeToggle = document.getElementById('theme-toggle');
  const html = document.documentElement;

  // Function to set theme
  function setTheme(theme) {
    if (theme === 'dark') {
      html.setAttribute('data-theme', 'dark');
      themeToggle.checked = true;
      localStorage.setItem('theme', 'dark');
    } else {
      html.removeAttribute('data-theme');
      themeToggle.checked = false;
      localStorage.setItem('theme', 'light');
    }
  }

  // Load saved theme or detect system preference
  function loadTheme() {
    const savedTheme = localStorage.getItem('theme');
    
    if (savedTheme) {
      setTheme(savedTheme);
    } else {
      // Detect system preference
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      setTheme(prefersDark ? 'dark' : 'light');
    }
  }

  // Listen for theme toggle
  themeToggle.addEventListener('change', function() {
    setTheme(this.checked ? 'dark' : 'light');
  });

  // Listen for system theme changes
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function(e) {
    // Only update if user hasn't manually set a preference
    if (!localStorage.getItem('theme')) {
      setTheme(e.matches ? 'dark' : 'light');
    }
  });

  // Initialize theme on page load
  loadTheme();
})();

