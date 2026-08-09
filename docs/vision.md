# rwnd.tv

rwnd.tv (rewind dot tv) is an open source project to help users track their TV Show and Movie watching activity.


## Aims

rwnd.tv is/can:

- An open source project, with a permissive MIT license.
- Runs in a docker container.
- Can import existing data from trakt.tv.
- Provides web hooks for media players like Plex to log activity.
- Provides a web interface, to both log activity and explore that data.
- Accessible.
- Themeable.
- Support multiple languages.
- Scalable from desktop to phone web browser.
- Support multiple users.
- Support exporting user data in an open manner.
- Uses open data (copyleft? wikidata?) and does not infringe upon the IP of others.

This is a living document whose aim is to capture the intent of the rwnd.tv project.

## Implementation

I am not a web developer. I plan to implement this project by using Claude Code and I will be open about that. My hope is that I can generate the skeleton of a project which will grow beyond me and be adopted by the community. However even if that fails to happen, I hope I can build something that will solve my own needs and maybe other.

## Metadata

The "open data" aim above is in tension with practical coverage: fully open sources (e.g. Wikidata) don't yet have the episode-level detail or artwork this app needs to be usable day to day. rwnd.tv resolves this by keeping metadata behind a `MetadataProvider` interface (see [ADR 0002](adr/0002-metadata-provider.md)) rather than calling any one source directly, so the TMDB adapter that ships first can be joined — or replaced — by a more open source later without a rewrite.
