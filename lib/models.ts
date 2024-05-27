export interface Root {
  checksum: string
  roots: Roots
}

export interface Roots {
  bookmark_bar: Folder
  other: Folder
  synced: Folder
  trash: Folder
}

interface Base {
  id: string
  date_added: string
  date_last_used: string
  date_modified?: string
  guid: string
  meta_info?: MetaInfo
  name: string
}

export interface Folder extends Base {
  type: "folder"
  children: (Folder | Bookmark)[]
  url: undefined
}

export interface Bookmark extends Base {
  type: "url"
  url: string
  children: undefined
}

export interface MetaInfo {
  Description?: string
  Thumbnail?: string
  power_bookmark_meta?: string
  Nickname?: string
  ThemeColor?: string
  Partner?: string
  Bookmarkbar?: string
}
