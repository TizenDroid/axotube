// resolveCommand lives on window._yttv[key].instance; scanning all keys on
// every call is O(n) per toast/modal. Cache the first working root and only
// rescan when the cached one stops resolving.
let cachedCommandRoot = null;

function validRoot(root) {
  return !!(root && root.instance && typeof root.instance.resolveCommand === "function");
}

function dispatchCommand(cmd, _) {
  if (validRoot(cachedCommandRoot)) {
    // A resolver is allowed to return undefined. Calling it again based on the
    // return value can execute non-idempotent commands twice.
    return cachedCommandRoot.instance.resolveCommand(cmd, _);
  }
  cachedCommandRoot = null;
  if (typeof window === "undefined" || !window._yttv) return;
  try {
    for (const key in window._yttv) {
      if (validRoot(window._yttv[key])) {
        cachedCommandRoot = window._yttv[key];
        return cachedCommandRoot.instance.resolveCommand(cmd, _);
      }
    }
  } catch (err) {
    cachedCommandRoot = null;
  }
}

function canDispatch() {
  if (validRoot(cachedCommandRoot)) return true;
  cachedCommandRoot = null;
  if (typeof window === "undefined" || !window._yttv) return false;
  try {
    for (const key in window._yttv) {
      if (validRoot(window._yttv[key])) {
        cachedCommandRoot = window._yttv[key];
        return true;
      }
    }
  } catch (err) {
    cachedCommandRoot = null;
  }
  return false;
}

function showToast(title, subtitle, thumbnails) {
  const overlayToastRenderer = {
    title: {
      simpleText: title,
    },
    subtitle: {
      simpleText: subtitle,
    },
    accessibilityData: {
      accessibilityData: {
        label: subtitle ? `${title} - ${subtitle}` : title,
      },
    },
    trackingParams: "CAEQlYkGGhMI",
  };

  if (thumbnails && thumbnails.length > 0) {
    overlayToastRenderer.image = { thumbnails };
  }

  const toastCmd = {
    openPopupAction: {
      popupType: "TOAST",
      popup: {
        overlayToastRenderer,
      },
    },
  };
  dispatchCommand(toastCmd);
}

function OverlayPanelHeaderRenderer(title, subtitle, thumbnails) {
  return {
    overlayPanelHeaderRenderer: {
      title: {
        simpleText: title,
      },
      subtitle: {
        simpleText: subtitle,
      },
      image: {
        thumbnails: thumbnails,
      },
      style: "OVERLAY_PANEL_HEADER_STYLE_VIDEO_THUMBNAIL",
    },
  };
}

function Modal(header, content, id, update) {
  const titleSubtitleObj =
    typeof header === "string" ? { title: header, subtitle: "" } : (header || { title: "", subtitle: "" });
  const overlayPanelHeaderRenderer = titleSubtitleObj.overlayPanelHeaderRenderer || {
    title: {
      simpleText: titleSubtitleObj.title,
    },
  };
  const modalCmd = {
    openPopupAction: {
      popupType: "MODAL",
      popup: {
        overlaySectionRenderer: {
          overlay: {
            overlayTwoPanelRenderer: {
              actionPanel: {
                overlayPanelRenderer: {
                  header: {
                    overlayPanelHeaderRenderer,
                  },
                  content,
                },
              },
              backButton: {
                buttonRenderer: {
                  accessibilityData: {
                    accessibilityData: {
                      label: "Back",
                    },
                  },
                  command: {
                    signalAction: {
                      signal: "POPUP_BACK",
                    },
                  },
                },
              },
            },
          },
          dismissalCommand: {
            signalAction: {
              signal: "POPUP_BACK",
            },
          },
        },
      },
      uniqueId: id,
    },
  };

  if (titleSubtitleObj.subtitle) {
    modalCmd.openPopupAction.popup.overlaySectionRenderer.overlay.overlayTwoPanelRenderer.actionPanel.overlayPanelRenderer.header.overlayPanelHeaderRenderer.subtitle =
      {
        simpleText: titleSubtitleObj.subtitle,
      };
  }

  if (update) {
    modalCmd.openPopupAction.shouldMatchUniqueId = true;
    modalCmd.openPopupAction.updateAction = true;
  }

  return modalCmd;
}

function showModal(header, content, id, update) {
  const modalCmd = Modal(header, content, id, update);
  dispatchCommand(modalCmd);
}

function overlayPanelItemListRenderer(items, selectedIndex) {
  return {
    overlayPanelItemListRenderer: {
      items,
      selectedIndex,
    },
  };
}

function buttonItem(title, icon, commands) {
  const button = {
    compactLinkRenderer: {
      serviceEndpoint: {
        commandExecutorCommand: {
          commands,
        },
      },
    },
  };

  if (title) {
    button.compactLinkRenderer.title = {
      simpleText: title.title,
    };
  }

  if (title && title.subtitle) {
    button.compactLinkRenderer.subtitle = {
      simpleText: title.subtitle,
    };
  }

  if (icon) {
    button.compactLinkRenderer.icon = {
      iconType: icon.icon,
    };
  }

  if (icon && icon.secondaryIcon) {
    button.compactLinkRenderer.secondaryIcon = {
      iconType: icon.secondaryIcon,
    };
  }

  return button;
}

function timelyAction(text, icon, command, triggerTimeMs, timeoutMs) {
  return {
    timelyActionRenderer: {
      actionButtons: [
        {
          buttonRenderer: {
            isDisabled: false,
            text: {
              runs: [
                {
                  text: text,
                },
              ],
            },
            icon: {
              iconType: icon,
            },
            trackingParams: null,
            command,
          },
        },
      ],
      triggerTimeMs,
      timeoutMs,
      type: "",
    },
  };
}

function longPressData(data) {
  return {
    clickTrackingParams: null,
    showMenuCommand: {
      contentId: data.videoId,
      thumbnail: {
        thumbnails: data.thumbnails,
      },
      title: {
        simpleText: data.title,
      },
      subtitle: {
        simpleText: data.subtitle,
      },
      menu: {
        menuRenderer: {
          items: [
            MenuNavigationItemRenderer("Play", {
              clickTrackingParams: null,
              watchEndpoint: data.watchEndpointData,
            }),
            MenuServiceItemRenderer("Save to Watch Later", {
              clickTrackingParams: null,
              playlistEditEndpoint: {
                playlistId: "WL",
                actions: [
                  {
                    addedVideoId: data.videoId,
                    action: "ACTION_ADD_VIDEO",
                  },
                ],
              },
            }),
            MenuNavigationItemRenderer("Save to Playlist", {
              clickTrackingParams: null,
              addToPlaylistEndpoint: {
                videoId: data.videoId,
              },
            }),
            MenuServiceItemRenderer("Add to Queue", {
              clickTrackingParams: null,
              playlistEditEndpoint: {
                customAction: {
                  action: "ADD_TO_QUEUE",
                  parameters: data.item,
                },
              },
            }),
          ],
          trackingParams: null,
          accessibility: {
            accessibilityData: {
              label: "Video options",
            },
          },
        },
      },
    },
  };
}

function MenuServiceItemRenderer(text, serviceEndpoint) {
  return {
    menuServiceItemRenderer: {
      text: {
        runs: [
          {
            text,
          },
        ],
      },
      serviceEndpoint,
      trackingParams: null,
    },
  };
}

function MenuNavigationItemRenderer(text, navigateEndpoint) {
  return {
    menuNavigationItemRenderer: {
      text: {
        runs: [
          {
            text,
          },
        ],
      },
      navigationEndpoint: navigateEndpoint,
      trackingParams: null,
    },
  };
}

function SettingsCategory(categoryId, items, title) {
  const category = {
    settingCategoryCollectionRenderer: {
      items,
      categoryId,
      focused: false,
      trackingParams: "null",
    },
  };

  if (title) {
    category.settingCategoryCollectionRenderer.title = {
      runs: [
        {
          text: title,
        },
      ],
    };
  }

  return category;
}

function SettingActionRenderer(
  title,
  itemId,
  serviceEndpoint,
  summary,
  thumbnail,
) {
  return {
    settingActionRenderer: {
      title: {
        runs: [
          {
            text: title,
          },
        ],
      },
      serviceEndpoint,
      summary: {
        runs: [
          {
            text: summary,
          },
        ],
      },
      trackingParams: "null",
      actionLabel: {
        runs: [
          {
            text: title,
          },
        ],
      },
      itemId,
      thumbnail: {
        thumbnails: [
          {
            url: thumbnail,
          },
        ],
      },
    },
  };
}

function scrollPaneRenderer(items) {
  return {
    scrollPaneRenderer: {
      content: {
        scrollPaneItemListRenderer: {
          items,
        },
      },
    },
  };
}

function overlayMessageRenderer(simpleText) {
  return {
    overlayMessageRenderer: {
      title: {
        simpleText,
      },
    },
  };
}

function ShelfRenderer(simpleText, items, selectedIndex = 0) {
  return {
    shelfRenderer: {
      shelfHeaderRenderer: {
        title: {
          simpleText,
        },
      },
      tvhtml5ShelfRendererType: "TVHTML5_SHELF_RENDERER_TYPE_GRID",
      content: {
        horizontalListRenderer: {
          items,
          selectedIndex,
          visibleItemCount: 3,
        },
      },
    },
  };
}

function TileRenderer(simpleText, onSelectCommand) {
  return {
    tileRenderer: {
      contentType: "TILE_CONTENT_TYPE_VIDEO",
      metadata: {
        tileMetadataRenderer: {
          title: {
            simpleText,
          },
        },
      },
      onSelectCommand,
      style: "TILE_STYLE_YTLR_DEFAULT",
    },
  };
}

function QrCodeRenderer(url) {
  return {
    qrCodeRenderer: {
      qrCodeImage: {
        thumbnails: [
          {
            url,
          },
        ],
      },
      style: "QR_CODE_RENDERER_STYLE_ATA_SIDESHEET",
      trackingParams: null,
    },
  };
}

function ButtonRenderer(disabled, text, iconType, command) {
  return {
    isDisabled: disabled,
    text: {
      runs: [
        {
          text: text,
        },
      ],
    },
    icon: {
      iconType,
    },
    command: command,
    trackingParams: null,
  };
}

export {
  showToast,
  canDispatch,
  Modal,
  OverlayPanelHeaderRenderer,
  showModal,
  buttonItem,
  overlayPanelItemListRenderer,
  overlayMessageRenderer,
  timelyAction,
  scrollPaneRenderer,
  longPressData,
  MenuServiceItemRenderer,
  SettingsCategory,
  SettingActionRenderer,
  ShelfRenderer,
  TileRenderer,
  QrCodeRenderer,
  ButtonRenderer,
};