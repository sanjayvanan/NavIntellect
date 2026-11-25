function ThemeToggle({ theme, onThemeChange }) {
  return (
    <button 
      className={`theme-toggle ${theme}`}
      onClick={() => onThemeChange(theme === 'light' ? 'dark' : 'light')}
      title="Toggle theme"
    >
      {theme === 'light' ? '🌙' : '☀️'}
    </button>
  )
}

export default ThemeToggle 