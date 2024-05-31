// Name: Bookmarks
// Keyword: bm

import "@johnlindquist/kit"
import { join } from "node:path"
import type { Choice } from "@johnlindquist/kit"
import sqlite3 from "sqlite3"
import type { Bookmark, Folder, Root } from "../lib/models"

const SUPPORTED_BROWSERS = ["Chrome", "Vivaldi"] as const
type SupportedBrowser = (typeof SUPPORTED_BROWSERS)[number]

const cacheDefaults = { favicons: null as { [url: string]: string } | null }
const cache = await db(cacheDefaults)

const browserKind = (await env("BOOKMARKS_BROWSER_KIND", {
  choices: [...SUPPORTED_BROWSERS],
  name: "Which Browser do you use?",
})) as SupportedBrowser

const { bookmarksJsonFile, faviconsDbFile } = getBrowserInstallationFiles(browserKind)

const favicons = await loadFavicons(faviconsDbFile)
const root = (await readJson(bookmarksJsonFile)) as Root

let bookmarks = root.roots.bookmark_bar.children

// Initializing an array to keep track of the navigation history
const historyStack: (Folder | Bookmark)[][] = []

type OptionValue = "go-back" | Folder | Bookmark

function buildChoices() {
  const createChoice = (item: Folder | Bookmark) => {
    if (item.type === "folder") {
      return {
        name: item.name,
        // Folder icon (can't put it in the code due to a Kit bug)
        html: `&#128193; ${item.name}`,
        value: item,
      } as Choice<OptionValue>
    }

    return {
      name: item.name,
      description: item.url,
      keyword: item.meta_info?.Nickname,
      img: favicons[item.url],
      value: item,
    } satisfies Choice<OptionValue>
  }

  // Generating options based on current level of bookmarks
  let choices: Choice<OptionValue>[] = bookmarks.map(createChoice)

  // Adding a "go back" option if there is a history in the stack
  if (historyStack.length > 0) {
    choices = [{ name: "⤴ ..", description: "Go back", value: "go-back" }, ...choices]
  }

  return choices
}

// Loop to handle user interaction and navigation within bookmarks
while (true) {
  const lastSelection = await arg(
    {
      name: "Select A Bookmark!",
      shortcuts: [
        {
          name: "Update Favicons",
          visible: true,
          bar: "right" as const,
          key: "ctrl+u",
          onPress: async () => {
            await loadFavicons(faviconsDbFile, false)
            setChoices(buildChoices())
            setName("Select A Bookmark!")
          },
        },
      ],
    },
    buildChoices(),
  )

  if (lastSelection === "go-back") {
    bookmarks = historyStack.pop()!
    continue
  }

  const { type, name } = lastSelection

  if (type === "folder") {
    // push the old bookmarks into the stack
    historyStack.push(bookmarks)
    bookmarks = bookmarks.find((bookmark) => bookmark.name === name)!.children ?? []
    continue
  }

  if (type === "url") {
    exec(`open "${lastSelection.url}"`)
    break
  }

  console.log("Unknown type", type)
}

function getBrowserInstallationFiles(browserKind: SupportedBrowser) {
  const platform: string = process.platform.toLowerCase()

  const installDir = (() => {
    switch (true) {
      case browserKind === "Chrome" && platform.includes("linux"):
        return home(".config", "google-chrome", "Default")
      case browserKind === "Chrome" && platform.includes("darwin"):
        return home("Library", "Application Support", "Google", "Chrome", "Default")
      case browserKind === "Chrome" && platform.includes("win32"):
        return home("AppData", "Local", "Google", "Chrome", "User Data", "Default")
      case browserKind === "Vivaldi" && platform.includes("win32"):
        return home("AppData", "Local", "Vivaldi", "User Data", "Default")
      default:
        throw new Error(
          `Not implemented: It is unknown where the ${browserKind} bookmarks path for platform ${process.platform} is. Please help us out with a pull request!`,
        )
    }
  })()

  if (!pathExistsSync(installDir)) {
    throw new Error(
      `${browserKind} bookmarks path determined to be at '${installDir}' according to system platform, but nothing exists at that location. Is ${browserKind} installed?`,
    )
  }

  return {
    bookmarksJsonFile: join(installDir, "Bookmarks"),
    faviconsDbFile: join(installDir, "Favicons"),
  } as const
}

async function loadFavicons(faviconsDbFile: string, allowCached = true) {
  if (allowCached && cache.favicons) {
    return cache.favicons
  }

  setHint("Loading Favicons...")

  const db = new sqlite3.Database(faviconsDbFile, sqlite3.OPEN_READONLY, (err) => {
    if (err) {
      throw err
    }
  })

  type BookmarkFavicon = { page_url: string; image_data: Buffer }

  const result = await new Promise<BookmarkFavicon[] | "locked">((resolve, reject) => {
    db.all<{ page_url: string; image_data: Buffer }>(
      "SELECT page_url, image_data FROM icon_mapping INNER JOIN favicons ON favicons.id = icon_mapping.icon_id INNER JOIN main.favicon_bitmaps fb on favicons.id = fb.icon_id",
      [],
      (err, rows) => {
        if (err) {
          if ("code" in err && err.code === "SQLITE_BUSY") {
            resolve("locked")
          }

          reject(err)
        }
        resolve(rows)
      },
    )
  })

  db.close()

  setHint("")

  if (result === "locked") {
    return await databaseLockedPrompt(faviconsDbFile)
  }

  const b64Map = result.reduce((agg, row) => {
    const { page_url, image_data } = row
    const b64 = `data:image/jpeg;base64,${image_data.toString("base64")}`
    agg.set(page_url, b64)
    return agg
  }, new Map<string, string>())

  const b64Data = Object.fromEntries(b64Map.entries())

  cache.favicons = b64Data
  cache.write().then()

  return b64Data
}

async function databaseLockedPrompt(faviconsDbFile: string) {
  const choice = await select(
    {
      hint: "Cannot read the Favicons database while the browser is still running. Please close it completely to cache the Favicons and continue to try again.",
      multiple: false,
    },
    [
      { name: "Retry", value: "retry" },
      { name: "Continue without Favicons", value: "without" },
    ],
  )

  setHint("")

  switch (choice) {
    case "without":
      return new Map<string, string>()
    case "retry":
      return await loadFavicons(faviconsDbFile, false)
  }
}
