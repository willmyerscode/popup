/**
 * Popup Plugin For Squarespace
 * Copywrite Will Myers @ Will-Myers.com
 */

if (typeof wmPopup === "undefined") {
  class wmPopup {
    static pluginTitle = "wmPopup";
    static defaultSettings = {
      openAnimation: "fade",
      openAnimationDuration: 300,
      closeOnOverlayClick: true,
      closeOnEscape: true,
      closePlacement: "content",
      maxWidth: "800px",
      maxHeight: "80vh",
      zIndex: 9999,
      debugLoading: false,
      loadingEl: `<div class="loading"></div>`,
      hooks: {
        beforeInit: [],
        afterInit: [],
        beforeOpenPopup: [],
        afterOpenPopup: [],
        beforeClosePopup: [],
        afterClosePopup: [],
      },
    };
    static get userSettings() {
      return window[wmPopup.pluginTitle + "Settings"] || {};
    }
    static emitEvent(type, detail = {}, elem = document) {
      // Make sure there's an event type
      if (!type) return;

      // Create a new event
      let event = new CustomEvent(type, {
        bubbles: true,
        cancelable: true,
        detail: detail,
      });

      // Dispatch the event
      return elem.dispatchEvent(event);
    }

    constructor() {
      this.settings = wm$.deepMerge(
        {},
        wmPopup.defaultSettings,
        wmPopup.userSettings
      );
      this.popups = new Map();
      this.activePopup = null;
      this.currentSelector = null;
      this.originalParent = null;
      this.originalNextSibling = null;
      this.scrollPosition = 0;
      this.init();
    }

    async init() {
      this.runHooks("beforeInit");
      wmPopup.emitEvent("wmPopup:beforeInit");
      this.beforeInit();
      this.buildStructure();
      this.bindEvents();
      this.overlay.style.display = "none";
      this.afterInit();
      wmPopup.emitEvent("wmPopup:afterInit");
      this.runHooks("afterInit");
    }

    buildStructure() {
      const overlay = document.createElement("div");
      overlay.className = "wm-popup-overlay";

      const container = document.createElement("div");
      container.className = "wm-popup-container";

      const closeButton = document.createElement("button");
      closeButton.className = "wm-popup-close";
      closeButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6">
      <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
    </svg>`;

      const content = document.createElement("div");
      content.className = "wm-popup-content";

      const loadingEl = document.createElement("div");
      loadingEl.className = "wm-popup-loading";
      loadingEl.innerHTML = this.settings.loadingEl;

      this.settings.closePlacement === "content"
        ? container.appendChild(closeButton)
        : overlay.appendChild(closeButton);
      container.appendChild(content);
      overlay.appendChild(container);
      overlay.appendChild(loadingEl);

      this.overlay = overlay;
      this.container = container;
      this.content = content;
      this.closeButton = closeButton;
      this.loadingEl = loadingEl;

      document.querySelector("#siteWrapper").appendChild(overlay);
    }

    bindEvents() {
      document.body.addEventListener("click", this.handleLinkClick.bind(this));
      this.closeButton.addEventListener("click", this.closePopup.bind(this));
      if (this.settings.closeOnOverlayClick) {
        this.overlay.addEventListener("click", e => {
          if (e.target === this.overlay) {
            this.closePopup();
          }
        });
      }
      if (this.settings.closeOnEscape) {
        document.addEventListener("keydown", e => {
          if (e.key === "Escape") {
            this.closePopup();
          }
        });
      }
    }

    async handleLinkClick(e) {
      const link = e.target.closest(
        'a[href^="#wm-popup="], a[href^="#wmpopup="]'
      );
      if (link) {
        e.preventDefault();
        const href = link.getAttribute("href");
        const prefixLength = href.startsWith("#wm-popup=")
          ? "#wm-popup=".length
          : "#wmpopup=".length;
        const fullPath = href.substring(prefixLength);
        let url, selector;

        if (fullPath.includes("#")) {
          [url, selector] = fullPath.split("#");
          selector = `#${selector}`;
        } else if (fullPath.includes(".fe-")) {
          const feIndex = fullPath.indexOf(".fe-");
          url = fullPath.substring(0, feIndex);
          selector = fullPath.substring(feIndex);
        } else if (fullPath.includes("[data-section-id=")) {
          const dataSectionIndex = fullPath.indexOf("[data-section-id=");
          url = fullPath.substring(0, dataSectionIndex);
          selector = fullPath.substring(dataSectionIndex);
        } else {
          url = fullPath;
          selector = null;
        }

        await this.openPopup(url, selector);
      }
    }

    async openPopup(url, selector = null) {
      this.runHooks("beforeOpenPopup", url);
      wmPopup.emitEvent("wmPopup:beforeOpenPopup", {
        url: url,
        selector: selector,
        el: this.overlay,
      });
      this.beforeOpenPopup();

      this.scrollPosition = window.scrollY;
      this.originalScrollBehavior =
        document.documentElement.style.scrollBehavior;
      document.documentElement.style.scrollBehavior = "auto";

      // Add a class to the body to enable our scroll lock styles
      document.body.classList.add("wm-popup-open");

      // Apply inline styles to maintain scroll position
      document.body.style.top = `-${this.scrollPosition}px`;
      document.body.style.position = "fixed";
      document.body.style.width = "100%";

      this.overlay.style.display = "block";
      this.container.style.display = "none";
      this.loadingEl.style.display = "block";
      this.content.style.display = "none";
      this.overlay.dataset.popupId = `${url}${selector ? selector : ''}`;

      if (this.settings.debugLoading) return;

      try {
        if (!this.popups.has(url)) {
          const content = await wm$.getFragment(url, "#sections");
          const initializedContent = await this.initializeContent(content);
          this.popups.set(url, initializedContent);
        }

        const popupContent = this.popups.get(url);
        this.content.innerHTML = "";
        if (selector) {
          const block = popupContent.querySelector(selector);
          if (block) {
            const colorTheme = block.closest("section")?.dataset.sectionTheme;
            block.dataset.sectionTheme = colorTheme;
            this.currentSelector = selector;
            this.originalParent = block.parentNode;
            this.originalNextSibling = block.nextSibling;
            this.content.appendChild(block);
          } else {
            throw new Error(`Selector "${selector}" not found in the content.`);
          }
        } else {
          // Move all child nodes of popupContent to this.content
          while (popupContent.firstChild) {
            this.content.appendChild(popupContent.firstChild);
          }
          this.currentSelector = null;
          this.originalParent = popupContent;
          this.originalNextSibling = null;
        }
      } catch (error) {
        console.error("Error fetching or displaying popup content:", error);
        this.overlay.dataset.popupId = null;
        const errorContent = this.createErrorContent(url, selector);
        this.popups.set(url, errorContent);
        this.content.appendChild(errorContent);
        this.currentSelector = null;
      }

      this.showPopupContent();
      this.activePopup = url;
      Squarespace.initializeSummaryV2Block(Y, Y.one(this.overlay));
      this.afterOpenPopup();
      wmPopup.emitEvent("wmPopup:afterOpenPopup", {
        url: url,
        selector: selector,
        el: this.overlay,
      });
      this.runHooks("afterOpenPopup", url);
    }

    createErrorContent(url, selector) {
      const errorElement = document.createElement("div");
      errorElement.className = "wm-popup-error";
      errorElement.innerHTML = `
      <h2>Error Loading Content</h2>
      <p>There was an error fetching the content. Doublecheck the URL${
        selector ? ` and target.` : `.`
      }</p>
      <p>URL: ${url}</p>
      ${selector ? `<p>Target: ${selector}</p>` : ``}
    `;
      return errorElement;
    }

    showPopupContent() {
      this.loadingEl.style.display = "none";
      this.content.style.display = "block";
      this.container.style.display = "block"; // Show the container
      this.container.style.opacity = "0";

      if (this.settings.openAnimation === "fade") {
        setTimeout(() => {
          this.container.style.transition = `opacity ${this.settings.openAnimationDuration}ms`;
          this.container.style.opacity = "1";
        }, 10);
      } else {
        this.container.style.opacity = "1";
      }
    }

    async initializeContent(content) {
      const tempContainer = document.createElement("div");
      tempContainer.classList.add("temp-popup-container");
      tempContainer.appendChild(content);

      // Insert the content into the last section for initialization
      const lastSection = document.querySelector(
        "#sections > section:last-of-type .content-wrapper"
      );

      lastSection.appendChild(tempContainer);

      // Initialize the content
      wm$.initializeAllPlugins();
      await wm$.reloadSquarespaceLifecycle(tempContainer);
      await wm$.initializeCodeBlocks(tempContainer);
      await wm$.initializeThirdPartyPlugins(tempContainer);

      // Remove the temporary container from the DOM
      lastSection.removeChild(tempContainer);

      return tempContainer.firstChild;
    }

    closePopup() {
      if (!this.activePopup) return;

      this.runHooks("beforeClosePopup", this.activePopup);
      this.beforeClosePopup();

      const closePopupContent = () => {
        if (this.originalParent) {
          // Move all children back to the original parent
          while (this.content.firstChild) {
            if (this.originalNextSibling) {
              this.originalParent.insertBefore(
                this.content.firstChild,
                this.originalNextSibling
              );
            } else {
              this.originalParent.appendChild(this.content.firstChild);
            }
          }
        }

        // Remove the class from the body
        document.body.classList.remove("wm-popup-open");

        // Reset the inline styles
        document.body.style.position = "";
        document.body.style.top = "";
        document.body.style.width = "";

        // Restore the scroll position
        window.scrollTo(0, this.scrollPosition);
        setTimeout(() => {
          document.documentElement.style.scrollBehavior =
            this.originalScrollBehavior;
        }, 50);

        this.overlay.style.display = "none";
        this.activePopup = null;
        this.currentSelector = null;
        this.originalParent = null;
        this.originalNextSibling = null;
        this.afterClosePopup();
        this.runHooks("afterClosePopup");
      };

      if (this.settings.openAnimation === "fade") {
        // Fade out the content
        this.container.style.opacity = "0";

        // Fade out the overlay
        this.overlay.style.transition = `opacity ${this.settings.openAnimationDuration}ms`;
        this.overlay.style.opacity = "0";

        // Wait for both fade animations to complete before closing
        setTimeout(() => {
          closePopupContent();
          // Reset overlay opacity and transition for next opening
          this.overlay.style.opacity = "";
          this.overlay.style.transition = "";
          this.overlay.dataset.popupId = null;
        }, this.settings.openAnimationDuration);
      } else {
        this.overlay.dataset.popupId = null;
        closePopupContent();
      }
    }

    runHooks(hookName, ...args) {
      const hooks = this.settings.hooks[hookName] || [];
      hooks.forEach(callback => {
        if (typeof callback === "function") {
          callback.apply(this, args);
        }
      });
    }
    beforeInit() {}
    afterInit() {
      wm$?.initializeAllPlugins();
    }
    beforeOpenPopup() {}
    afterOpenPopup() {
      this.playSingleVideo();
    }
    beforeClosePopup() {}
    afterClosePopup() {}
    playSingleVideo() {
      const hasOnlyVideo = this.content.querySelector(
        ":scope > .sqs-block-video[data-block-json], :scope > .fe-block .sqs-block-video[data-block-json]"
      );
      if (hasOnlyVideo) {
        window.setTimeout(() => {
          const json = JSON.parse(hasOnlyVideo.dataset.blockJson);
          const video = hasOnlyVideo.querySelector("video");
          if (!json || !json.settings || !video) return;
          video.muted = false;
          json.settings.autoPlay ? video.play() : null;
        }, 100);
      }
    }
  }

  // Initialize the popup only if it hasn't been initialized before
  if (!window.wmPopup) {
    window.wmPopup = new wmPopup();
  }
}
