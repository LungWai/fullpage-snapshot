# Example Annotation Presets

This folder contains example JSON preset files that demonstrate how to create reusable annotation templates.

## What are Presets?

Presets are JSON files containing annotation definitions that can be applied to multiple images. They use normalized coordinates (0-1 range) so the same preset works on images of different sizes.

## How to Use

1. In the editor, load your images
2. Click "Choose File" next to "Batch preset import"
3. Select a preset JSON file
4. All shapes will be applied to all loaded images

## Example Files

### redaction-preset.json

A practical example showing:
- Two black redaction boxes at the top (header areas)
- One red highlight rectangle in the center

**Use case**: Redacting headers/footers and highlighting main content

## Creating Your Own Presets

1. Annotate an image in the editor
2. Click "Export actions JSON"
3. Save the file
4. Edit coordinates/colors as needed
5. Import into other sessions

## Preset Format

```json
[
  {
    "type": "rect-fill" or "rect-stroke",
    "color": "#rrggbb",
    "strokeWidth": number (1-64),
    "fillOpacity": number (0-1),
    "nx": number (0-1, horizontal position),
    "ny": number (0-1, vertical position),
    "nw": number (0-1, width ratio),
    "nh": number (0-1, height ratio)
  }
]
```

## Coordinate System

- **nx**: Left edge position (0 = left side, 1 = right side)
- **ny**: Top edge position (0 = top, 1 = bottom)
- **nw**: Width as fraction of image width
- **nh**: Height as fraction of image height

## Tips

- Use `rect-fill` with opacity 1.0 for complete redaction
- Use `rect-stroke` for non-destructive highlighting
- Test on one image before batch-applying
- Keep presets organized by use case 