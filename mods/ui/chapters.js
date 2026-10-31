function parseTimestamps(input) {
  let lines = input.trim().split("\n");
  let result = [];
  let timestampRegex = /^\d+:\d{2}/;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    let match = line.match(timestampRegex);
    if (match) {
      let timePart = match[0];
      let parts = line.split(" ");
      parts.shift();
      let timeParts = timePart.split(":");
      let minutes = parseInt(timeParts[0], 10);
      let seconds = parseInt(timeParts[1], 10);
      let milliseconds = (minutes * 60 + seconds) * 1000;
      let name = parts.join(" ");
      result.push({ time: milliseconds, name: name });
    }
  }
  return result;
}

function marker(title, start, duration, videoID, i) {
  return {
    title: {
      simpleText: title,
    },
    startMillis: start,
    durationMillis: duration,
    thumbnailDetails: {
      thumbnails: [
        {
          url: `https://i.ytimg.com/vi/${videoID}/hqdefault.jpg`,
          width: 320,
          height: 180,
        },
      ],
    },
    onActive: {
      innertubeCommand: {
        clickTrackingParams: null,
        entityUpdateCommand: {
          entityBatchUpdate: {
            mutations: [
              {
                entityKey: `${videoID}${start}${duration}`,
                type: "ENTITY_MUTATION_TYPE_REPLACE",
                payload: {
                  markersEngagementPanelSyncEntity: {
                    key: `${videoID}${start}${duration}`,
                    panelId: "engagement-panel-macro-markers-description-chapters",
                    activeItemIndex: i,
                    syncEnabled: true,
                  },
                },
              },
            ],
          },
        },
      },
    },
  };
}

function markerEntity(videoID, markers) {
  return {
    entityKey: `${videoID}-key`,
    type: "ENTITY_MUTATION_TYPE_REPLACE",
    payload: {
      macroMarkersListEntity: {
        key: `${videoID}-key`,
        externalVideoId: videoID,
        markersList: {
          markerType: "MARKER_TYPE_CHAPTERS",
          markers: markers,
          headerTitle: {
            runs: [
              {
                text: "Chapters",
              },
            ],
          },
          onTap: {
            innertubeCommand: {
              clickTrackingParams: null,
              changeEngagementPanelVisibilityAction: {
                targetId: "engagement-panel-macro-markers-description-chapters",
                visibility: "ENGAGEMENT_PANEL_VISIBILITY_EXPANDED",
              },
            },
          },
          markersEdu: {
            enterNudgeText: {
              runs: [
                {
                  text: "To view chapters, press the up arrow button",
                },
              ],
            },
            enterNudgeA11yText: "To view chapters, press the up arrow button",
            navNudgeText: {
              runs: [
                {
                  text: "Navigate between chapters",
                },
              ],
            },
            navNudgeA11yText: "Press the left or right arrow button to navigate between chapters",
          },
          loggingDirectives: {
            trackingParams: null,
            enableDisplayloggerExperiment: true,
          },
        },
      },
    },
  };
}

export default function Chapters(video) {
  const videoID =
    video.contents.singleColumnWatchNextResults.results.results.contents[0].itemSectionRenderer
      .contents[0].videoMetadataRenderer.videoId;
  const videoDescription =
    video.contents.singleColumnWatchNextResults.results.results.contents[0].itemSectionRenderer
      .contents[0].videoMetadataRenderer.description.runs[0].text;
  const chapters = parseTimestamps(videoDescription);
  const videoDuration = document.getElementsByTagName("video")[0].duration * 1000;
  let markers = [];

  for (let i = 0; i < chapters.length; i++) {
    const chapter = chapters[i];
    const nextChapter = chapters[i + 1];
    const duration = nextChapter ? nextChapter.time - chapter.time : videoDuration - chapter.time;
    markers.push(marker(chapter.name, String(chapter.time), String(duration), videoID, i));
  }

  const markerEntityData = markerEntity(videoID, markers);
  return markerEntityData;
}
