/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/* globals ChromeUtils, ExtensionAPI, ExtensionCommon, Services */

"use strict";

ChromeUtils.defineModuleGetter(this, "Services",
                               "resource://gre/modules/Services.jsm");

ChromeUtils.defineModuleGetter(this, "UIState",
                               "resource://services-sync/UIState.jsm");
ChromeUtils.defineModuleGetter(this, "ObjectUtils",
                               "resource://gre/modules/ObjectUtils.jsm");
ChromeUtils.defineModuleGetter(this, "setTimeout",
                               "resource://gre/modules/Timer.jsm");
ChromeUtils.defineModuleGetter(this, "ExtensionPreferencesManager",
                               "resource://gre/modules/ExtensionPreferencesManager.jsm");

// Cribbed from browser.js with some changes to allow for our strings
let ConfirmationHint = {
  /**
   * Shows a transient, non-interactive confirmation hint anchored to an
   * element, usually used in response to a user action to reaffirm that it was
   * successful and potentially provide extra context. Examples for such hints:
   * - "Saved to Library!" after bookmarking a page
   * - "Sent!" after sending a tab to another device
   * - "Queued (offline)" when attempting to send a tab to another device
   *   while offline
   *
   * @param  anchor (DOM node, required)
   *         The anchor for the panel.
   * @param  messageContent (string, required)
   *         The string that we will display.
   * @param  options (object, optional)
   *         An object with the following optional properties:
   *         - event (DOM event): The event that triggered the feedback.
   *         - hideArrow (boolean): Optionally hide the arrow.
   *         - showDescription (boolean): show description text (confirmationHint.<messageId>.description)
   *
   */
  show(selector, messageContent, options = {}) {
    const anchor = Services.wm.getMostRecentWindow("navigator:browser").document.querySelector(selector);
    this._message.textContent = messageContent;

    this._description.hidden = true;
    this._panel.classList.remove("with-description");

    if (options.hideArrow) {
      this._panel.setAttribute("hidearrow", "true");
    }

    // TODO fix CSS fragility with conflicting with firefox and hardcoded vars
    this.setCSS("#0060ED", "#fff");
    this.setIcon();
    if (options.isWarning) {
      this.setCSS("#fff36e", "#0c0c0d");
      this.setIcon("chrome://global/skin/icons/warning.svg");
    }

    const DURATION = 8500;
    this._panel.addEventListener("popupshown", () => {
      this._animationBox.setAttribute("animate", "true");

      setTimeout(() => {
        this._panel.hidePopup(true);
        this.setCSS();
        this.setIcon();
      }, DURATION + 120);
    }, {once: true});

    this._panel.addEventListener("popuphidden", () => {
      this._panel.removeAttribute("hidearrow");
      this._animationBox.removeAttribute("animate");
    }, {once: true});

    this._panel.hidden = false;
    this._panel.openPopup(anchor, {
      position: "bottomcenter topleft",
      triggerEvent: options.event,
    });
  },

  setCSS(backgroundColor = "", textColor = "") {
    this._panel.style.setProperty("--arrowpanel-background", backgroundColor);
    this._panel.style.setProperty("--arrowpanel-border-color", backgroundColor);
    this._panel.style.setProperty("--arrowpanel-color", textColor);
  },

  setIcon(iconUrl = "") {
    let checkmarkImage = this._panel.querySelector("#confirmation-hint-checkmark-image");
    let properties = {
      background: `url("${iconUrl}") 0 0 / contain`,
      fill: "black",
      "-moz-context-properties": "fill",
      "animation-name": "none",
    };
    for (let property in properties) {
      if (iconUrl) {
        checkmarkImage.style.setProperty(property, properties[property]);
      } else {
        checkmarkImage.style.removeProperty(property);
      }
    }
  },

  get _document() {
    return Services.wm.getMostRecentWindow("navigator:browser").document;
  },

  get _panel() {
    delete this._panel;
    return this._panel = this._document.getElementById("confirmation-hint");
  },

  get _animationBox() {
    delete this._animationBox;
    return this._animationBox = this._document.getElementById("confirmation-hint-checkmark-animation-container");
  },

  get _message() {
    delete this._message;
    return this._message = this._document.getElementById("confirmation-hint-message");
  },

  get _description() {
    delete this._description;
    return this._description = this._document.getElementById("confirmation-hint-description");
  },
};

ExtensionPreferencesManager.addSetting("network.trr.mode", {
  prefNames: ["network.trr.mode"],

  setCallback(value) {
    return { [this.prefNames[0]]: value };
  },
});

this.proxyutils = class extends ExtensionAPI {
 constructor(...args) {
    super(...args);
    this.wasOffline = false;
  }

  getAPI(context) {
    const EventManager = ExtensionCommon.EventManager;
    let {
      Management: {
        global: { tabTracker },
      },
    } = ChromeUtils.import("resource://gre/modules/Extension.jsm", null);
    let { extension } = context;

    let { tabManager, windowManager } = extension;

    function getTabOrActive(tabId) {
      let tab =
        tabId !== null ? tabTracker.getTab(tabId) : tabTracker.activeTab;
      if (!context.canAccessWindow(tab.ownerGlobal)) {
        throw new ExtensionError(
          tabId === null
            ? "Cannot access activeTab"
            : `Invalid tab ID: ${tabId}`
        );
      }
      return tab;
    }

    return {
      experiments: {
        proxyutils: {
          DNSoverHTTPEnabled: {
            async get(details) {
              return {
                levelOfControl: "controllable_by_this_extension",
                value: Preferences.get("network.trr.mode"),
              };
            },
            set(details) {
              return ExtensionPreferencesManager.setSetting(
                context.extension.id,
                "network.trr.mode",
                details.value
              );
            },
            clear(details) {
              return ExtensionPreferencesManager.removeSetting(
                context.extension.id,
                "network.trr.mode");
            },
          },

          onChanged: new EventManager({
            context,
            name: "proxyutils.onChanged",
            register: fire => {
              let observer = _ => fire.async();
              Services.prefs.addObserver("network.proxy.type", observer);
              return () => {
                Services.prefs.removeObserver("network.proxy.type", observer);
              }
            }
          }).api(),

          async showPrompt(message, isWarning) {
            const selector = "#secure-proxy_mozilla_com-browser-action";
            ConfirmationHint.show(selector, message, {isWarning});
          },

          async getCaptivePortalURL() {
            return Services.prefs.getStringPref("captivedetect.canonicalURL");
          },

          async getDebuggingMode() {
            return Services.prefs.getBoolPref("secureProxy.debugging.enabled", false);
          },

          async formatURL(url) {
            return Services.urlFormatter.formatURL(url);
          },

          async loadNetError(errorCode, tabId) {
            let nativeTab = getTabOrActive(tabId);
            let uri = Services.uriFixup.createExposableURI(nativeTab.linkedBrowser.currentURI);
            let errorEnum = "NS_ERROR_PROXY_BAD_GATEWAY";
            if (errorCode == 407 && errorCode == 429) {
              errorEnum = "NS_ERROR_UNKNOWN_PROXY_HOST";
            }
            const code =  `let spec = "${uri.spec}"; let uri = Services.uriFixup.createExposableURI(Services.io.newURI(spec)); docShell.displayLoadError(Cr.${errorEnum}, uri, docShell.failedChannel);`;
            const mm = nativeTab.linkedBrowser.messageManager;
            mm.loadFrameScript(`data:,${encodeURI(code)}`, false);
          }
        },
      },
    };
  }
};
