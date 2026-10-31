import Foundation
import ImageIO
import CoreGraphics

/// Decode off the UI actor and cap decoded memory while checking the real image dimensions.
enum BackdropImageDecoder {
    static func decode(_ data: Data) -> CGImage? {
        guard data.count <= 24 * 1024 * 1024,
              let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary),
              CGImageSourceGetCount(source) == 1,
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let width = properties[kCGImagePropertyPixelWidth] as? Int,
              let height = properties[kCGImagePropertyPixelHeight] as? Int,
              BackdropArtwork.validDimensions(width: width, height: height) else { return nil }
        let options: [CFString: Any] = [kCGImageSourceCreateThumbnailFromImageAlways: true,
                                      kCGImageSourceCreateThumbnailWithTransform: true,
                                      kCGImageSourceThumbnailMaxPixelSize: 3840,
                                      kCGImageSourceShouldCacheImmediately: true]
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary),
              BackdropArtwork.validDimensions(width: image.width, height: image.height) else { return nil }
        return image
    }
}
