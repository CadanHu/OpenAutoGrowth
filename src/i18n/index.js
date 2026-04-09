import en from './locales/en.js';
import zh from './locales/zh.js';

const translations = { en, zh };

class I18n {
  constructor() {
    this.locale = localStorage.getItem('locale') || (navigator.language.startsWith('zh') ? 'zh' : 'en');
  }

  setLocale(locale) {
    if (translations[locale]) {
      this.locale = locale;
      localStorage.setItem('locale', locale);
      this.updateUI();
      document.dispatchEvent(new CustomEvent('languageChanged', { detail: locale }));
    }
  }

  t(key, params = {}) {
    let text = translations[this.locale][key] || key;
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(new RegExp(`{${k}}`, 'g'), v);
    }
    return text;
  }

  updateUI() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (translations[this.locale][key]) {
        if (el.hasAttribute('placeholder')) {
          el.placeholder = this.t(key);
        } else {
          el.innerHTML = this.t(key);
        }
      }
    });
    document.documentElement.lang = this.locale === 'zh' ? 'zh-CN' : 'en';
  }
}

export const i18n = new I18n();
