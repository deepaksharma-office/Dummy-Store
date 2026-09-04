import { CartLinesUpdateEvent } from '@shopify/events';

class BundleBuilder extends HTMLElement {
  connectedCallback() {
    this.form = this.querySelector('[data-bundle-form]');
    this.cards = [...this.querySelectorAll('[data-bundle-product]')];
    this.submitButton = this.querySelector('[data-bundle-submit]');
    this.status = this.querySelector('[data-bundle-status]');
    this.progress = this.querySelector('[data-bundle-progress]');
    this.countOutput = this.querySelector('[data-bundle-count]');
    this.tiers = [...this.querySelectorAll('[data-tier]')];

    this.form?.addEventListener('change', this.update);
    this.form?.addEventListener('submit', this.addBundle);
    this.update();
  }

  disconnectedCallback() {
    this.form?.removeEventListener('change', this.update);
    this.form?.removeEventListener('submit', this.addBundle);
  }

  get selectedCards() {
    return this.cards.filter((card) => card.querySelector('[data-product-toggle]')?.checked);
  }

  update = () => {
    const count = this.selectedCards.length;
    const highestTier = Math.max(1, ...this.tiers.map((tier) => Number(tier.dataset.tier)));
    const percent = Math.min(100, (count / highestTier) * 100);

    this.style.setProperty('--bundle-progress', `${percent}%`);
    this.progress?.setAttribute('aria-valuenow', String(count));
    if (this.countOutput) this.countOutput.textContent = String(count);
    if (this.submitButton) this.submitButton.disabled = count === 0;

    this.cards.forEach((card) => {
      const selected = card.querySelector('[data-product-toggle]')?.checked;
      card.toggleAttribute('data-selected', Boolean(selected));
    });

    this.tiers.forEach((tier) => {
      const unlocked = count >= Number(tier.dataset.tier);
      tier.toggleAttribute('data-unlocked', unlocked);
      tier.setAttribute('aria-label', `${tier.dataset.label}: ${unlocked ? 'unlocked' : 'locked'}`);
    });
  };

  addBundle = async (event) => {
    event.preventDefault();
    const items = this.selectedCards.map((card) => ({
      id: Number(card.querySelector('[data-variant-select]')?.value),
      quantity: 1,
      properties: { _Bundle: this.dataset.bundleName || 'Build your bundle' },
    }));
    if (!items.length || !this.submitButton) return;

    this.submitButton.disabled = true;
    this.submitButton.setAttribute('aria-busy', 'true');
    this.setStatus('Adding your bundle…');

    const deferred = CartLinesUpdateEvent.createPromise();
    this.dispatchEvent(new CartLinesUpdateEvent({
      action: 'add',
      context: 'bundle-builder',
      lines: items.map((item) => ({ merchandiseId: String(item.id), quantity: item.quantity })),
      promise: deferred.promise,
    }));

    try {
      const root = window.Shopify?.routes?.root || '/';
      const sections = [...document.querySelectorAll('cart-items-component[data-section-id]')]
        .map((component) => component.dataset.sectionId)
        .filter(Boolean);
      if (!sections.includes('cart-drawer-section')) sections.push('cart-drawer-section');

      const response = await fetch(`${root}cart/add.js`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ items, sections: sections.join(','), sections_url: window.location.pathname }),
      });
      const result = await response.json();
      if (!response.ok || result.status) throw new Error(result.description || result.message || 'Could not add bundle');

      const cartResponse = await fetch(`${root}cart.js`, { headers: { Accept: 'application/json' } });
      const cart = await cartResponse.json();
      deferred.resolve({
        cart: CartLinesUpdateEvent.createCartFromAjaxResponse(cart),
        detail: {
          items: cart.items,
          itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
          source: 'bundle-builder',
          sourceId: this.id,
          sections: result.sections,
          didError: false,
        },
      });
      this.setStatus('Bundle added to your cart.');
    } catch (error) {
      deferred.resolve({ cart: null, detail: { didError: true, source: 'bundle-builder' } });
      this.setStatus(error instanceof Error ? error.message : 'Could not add bundle. Please try again.', true);
      this.submitButton.disabled = false;
    } finally {
      this.submitButton.removeAttribute('aria-busy');
      this.submitButton.disabled = this.selectedCards.length === 0;
    }
  };

  setStatus(message, isError = false) {
    if (!this.status) return;
    this.status.textContent = message;
    this.status.toggleAttribute('data-error', isError);
  }
}

if (!customElements.get('bundle-builder')) customElements.define('bundle-builder', BundleBuilder);
