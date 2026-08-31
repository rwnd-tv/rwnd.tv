# rwnd.tv

rwnd.tv (rewind dot tv) is an open source project to help users track their TV Show and Movie watching activity.

## Aims

Delivered, as of v1.0.0:

- An open source project, with a permissive MIT license.
- Runs in a docker container.
- Can import existing data from trakt.tv.
- Provides web hooks for media players like Plex to log activity.
- Provides a web interface, to both log activity and explore that data.
- Themeable.
- Support multiple languages: en-GB and en-US ship today; the
  infrastructure (a `SUPPORTED_LOCALES` list, per-locale string files) is
  built to add more, but "multiple" so far means regional English, not yet
  a genuinely different language.
- Support multiple users.
- Support exporting user data in an open manner.

Still aspirational, not disproven, just not built or verified yet:

- Accessible. No dedicated accessibility audit has been done.
- Scalable from desktop to phone web browser. The UI is responsive but
  hasn't been deliberately tested against a range of real devices.
- Uses open data and does not infringe upon the IP of others. In tension
  with the Metadata section below: genuinely open sources (Wikidata etc.)
  aren't yet detailed enough for this app to be usable day to day, so
  today's metadata comes from TMDB and TheTVDB instead, both used within
  their terms and attributed, neither open in the copyleft sense.

This is a living document whose aim is to capture the intent of the rwnd.tv project.

## Implementation

I am not a web developer. I plan to implement this project by using Claude Code and I will be open about that. My hope is that I can generate the skeleton of a project which will grow beyond me and be adopted by the community. However even if that fails to happen, I hope I can build something that will solve my own needs and maybe other.

## Metadata

The "open data" aim above is in tension with practical coverage: fully open sources (e.g. Wikidata) don't yet have the episode-level detail or artwork this app needs to be usable day to day. rwnd.tv resolves this by keeping metadata behind a `MetadataProvider` interface (see [ADR 0002](adr/0002-metadata-provider.md)) rather than calling any one source directly, so today's two adapters (TMDB and TheTVDB, see [ADR 0006](adr/0006-multi-provider-metadata.md)) can be joined, or eventually replaced, by a more open source later without a rewrite.
