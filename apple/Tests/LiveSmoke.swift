import Foundation

@main
struct LiveSmoke {
    static func main() async throws {
        let root = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
        let configuration = try JSONDecoder().decode(SourceConfiguration.self, from: Data(contentsOf: root.appendingPathComponent("Resources/sources.json")))
        let text = try String(contentsOf: root.appendingPathComponent("Resources/channels.m3u"), encoding: .utf8)
        let bundled = MediaRepository.parseM3U(text)
        precondition(!bundled.isEmpty)
        precondition(Set(bundled.map(\.id)).count == bundled.count)
        let repository = MediaRepository()
        let result = await repository.refreshChannels(configuration.liveSubscriptions, bundled: bundled)
        precondition(result.channels.count >= bundled.count)
        precondition(Array(result.channels.prefix(bundled.count)) == bundled)
        precondition(Set(result.channels.map(\.id)).count == result.channels.count)
        let data = try JSONSerialization.data(withJSONObject: [
            "bundledChannelCount": bundled.count,
            "channelCountAfterOnlineRefresh": result.channels.count,
            "groupCount": Set(result.channels.map(\.group)).count,
            "warnings": result.warnings,
            "bundledOrderPreserved": true,
            "duplicateURLsRemoved": true,
            "mediaPlaybackVerified": false
        ], options: [.prettyPrinted, .sortedKeys])
        print(String(decoding: data, as: UTF8.self))
    }
}
