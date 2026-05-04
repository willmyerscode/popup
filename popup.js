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
      preloadContent: false,
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
      
      // Only create SEO container and preload if enabled
      if (this.settings.preloadContent) {
        this.createSEOContainer();
        await this.preloadPopupContent();
      }

      
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
        'a[href^="#wm-popup="], a[href^="#wmpopup="], a[href^="/#wm-popup="], a[href^="/#wmpopup="]'
      );
      if (link) {
        e.preventDefault();
        const href = link.getAttribute("href");
        const prefixLength = href.startsWith("/#wm-popup=")
          ? "/#wm-popup=".length
          : href.startsWith("/#wmpopup=")
          ? "/#wmpopup=".length
          : href.startsWith("#wm-popup=")
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

      // Calculate scrollbar width and add padding if needed
      const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
      
      this.scrollPosition = window.scrollY;
      this.originalScrollBehavior = getComputedStyle(document.documentElement).scrollBehavior;
      document.documentElement.style.scrollBehavior = "auto";

      // Add padding to both body and header to prevent layout shift
      document.body.classList.add("wm-popup-open");
      document.body.style.setProperty('--wm-popup-freeze-scroll-padding-right', `${scrollbarWidth}px`);
      document.body.style.setProperty('--wm-popup-freeze-scroll-top', `-${this.scrollPosition}px`);

      this.overlay.style.display = "block";
      this.container.style.display = "none";
      this.loadingEl.style.display = "block";
      this.content.style.display = "none";
      document.body.dataset.activePopup = `${url}${selector ? selector : ""}`;

      if (this.settings.debugLoading) return;

      try {

        if (!this.popups.has(url)) {
          const content = await wm$.getFragment(url, "#sections");
          if (!content.children || content.children.length === 0) {
            const emptyContent = this.createEmptyContent(url);
            this.popups.set(url, emptyContent);
          } else {
            const initializedContent = await this.initializeContent(content);
            this.popups.set(url, initializedContent);
          }
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
        document.body.dataset.activePopup = null;
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

    createEmptyContent(url) {
      const emptyElement = document.createElement("div");
      emptyElement.className = "wm-popup-empty";
      emptyElement.innerHTML = `<p>This page doesn't have any sections yet. Add a section to <strong>${url}</strong> to see content here.</p>`;
      return emptyElement;
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
      this.loadAllImages(this.content);
      this.queueLayoutRefresh();

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
      let lastSection = null;
      if (document.querySelector("#sections > section:last-of-type .content-wrapper, #page-regions > section:last-of-type .content-wrapper")) {
        lastSection = document.querySelector(
          "#sections > section:last-of-type .content-wrapper, #page-regions > section:last-of-type .content-wrapper"
        );
      } else if (document.querySelectorAll("#sections .page-section").length > 0) {
        const pageSections = document.querySelectorAll("#sections .page-section");
        lastSection = pageSections[pageSections.length - 1];
      } else if (document.querySelector("#page .system-page")) {
        lastSection = document.querySelector(
          "#page .system-page"
        );
      } else {
        console.error("No last section found");
      }

      if (lastSection) {
        lastSection.appendChild(tempContainer);
      } else {
        console.error("No last section found");
      }

      // Initialize the content
      wm$.initializeAllPlugins();
      await wm$.reloadSquarespaceLifecycle(tempContainer);

      try {
        if (typeof wm$.initializeCodeBlocks === 'function') {
          await wm$.initializeCodeBlocks(tempContainer);
        }
        if (typeof wm$.initializeEmbedBlocks === 'function') {
          await wm$.initializeEmbedBlocks(tempContainer);
        }
        if (typeof wm$.initializeThirdPartyPlugins === 'function') {
          await wm$.initializeThirdPartyPlugins(tempContainer);
        }
      } catch (error) {
        console.error('Error during initialization:', error);
      }

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

        // First, remove the fixed positioning but maintain the negative top
        document.documentElement.style.scrollBehavior = 'unset'

        // Restore scroll position before removing styles
        window.scrollTo(0, this.scrollPosition);

        // Reset all styles in a single frame to prevent flicker
        requestAnimationFrame(() => {
          document.body.style.removeProperty('--wm-popup-freeze-scroll-padding-right');
          document.body.style.removeProperty('--wm-popup-freeze-scroll-top');
          document.body.style.removeProperty('--wm-popup-freeze-scroll-scroll-behavior');
          
          setTimeout(() => {
            document.documentElement.style.scrollBehavior = this.originalScrollBehavior || '';
          }, 50);
        });

        // Reset modal scroll so the next open doesn't reuse the previous popup's position
        this.container.scrollTop = 0;
        this.container.scrollLeft = 0;

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
          document.body.dataset.activePopup = null;
        }, this.settings.openAnimationDuration);
      } else {
        document.body.dataset.activePopup = null;
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
    loadAllImages(el = document) {
      const imageLoader = window.ImageLoader || window.Squarespace?.ImageLoader;
      if (!imageLoader || typeof imageLoader.load !== "function") return;

      const images = el.querySelectorAll("img[data-src]");
      for (let i = 0; i < images.length; i++) {
        imageLoader.load(images[i], { load: true });
      }
    }
    queueLayoutRefresh() {
      // Native resize is global; prefer targeted gallery refresh in popup, fallback to resize.
      const refresh = () => {
        Squarespace.initializeLayoutBlocks(Y, Y.one(this.content));  
      };

      requestAnimationFrame(refresh);

      if (this.settings.openAnimation === "fade") {
        setTimeout(refresh, this.settings.openAnimationDuration + 20);
      }
    }
    playSingleVideo() {
      const hasOnlyVideo = this.content.querySelector(
        ":scope > .sqs-block-video[data-block-json], :scope > .fe-block .sqs-block-video[data-block-json]"
      );
      if (hasOnlyVideo) {
        const json = JSON.parse(hasOnlyVideo.dataset.blockJson);
        let video = hasOnlyVideo.querySelector("video");
        if (!json || !json.settings) return;

        const playVideo = () => {
          video.play().then(() => {
            video.muted = false;
          }).catch(error => {
            console.log('Autoplay with sound failed:', error);
            video.muted = true;
            video.play();
          });
        };

        const checkVideoLoaded = (attempts = 0) => {
          video = hasOnlyVideo.querySelector("video");
          if (video) {
            video.addEventListener('canplay', playVideo, { once: true });
            if (video.readyState >= 4) {
              playVideo();
            }
          } else if (attempts < 10) {
            setTimeout(() => checkVideoLoaded(attempts + 1), 100);
          }
        };

        checkVideoLoaded();
      }
    }

    // Add new method for preloading
    async preloadPopupContent() {
      const popupLinks = document.querySelectorAll('a[href^="#wm-popup="], a[href^="#wmpopup="]');
      
      for (const link of popupLinks) {
        const href = link.getAttribute("href");
        const prefixLength = href.startsWith("/#wm-popup=")
          ? "/#wm-popup=".length
          : href.startsWith("/#wmpopup=")
          ? "/#wmpopup=".length
          : href.startsWith("#wm-popup=")
          ? "#wm-popup=".length
          : "#wmpopup=".length;
        const fullPath = href.substring(prefixLength);
        let url = fullPath.split('#')[0]; // Get just the URL part
        
        if (!this.popups.has(url)) {
          try {
            const content = await wm$.getFragment(url, "#sections");
            const wrapper = document.createElement("div");
            wrapper.dataset.popupUrl = url;
            wrapper.dataset.popupContent = 'true';
            wrapper.appendChild(content);
            const result = await this.initializeContent(wrapper);
            this.seoContainer.appendChild(wrapper);
            this.popups.set(url, result);
          } catch (error) {
            console.error(`Error preloading popup content for ${url}:`, error);
            const errorContent = this.createErrorContent(url);
            this.popups.set(url, errorContent);
          }
        }
      }
    }

    createSEOContainer() {
      const seoContainer = document.createElement('div');
      seoContainer.className = 'wm-popup-seo-container';
      seoContainer.setAttribute('aria-hidden', 'true');
      seoContainer.style.cssText = `
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      `;
      document.querySelector("#siteWrapper").appendChild(seoContainer);
      this.seoContainer = seoContainer;
    }
  }

  // Initialize the popup only if it hasn't been initialized before
  if (!window.wmPopup) {
    window.wmPopup = new wmPopup();
  }
}
