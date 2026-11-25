// Import-boundary and RTL checks for the Flutter app (spec 4.5, 15). Pure functions over file text
// so they can be tested with good and bad fixtures. Run: dart run tool/check_boundaries.dart
class Violation {
  const Violation(this.rule, this.file, this.detail);
  final String rule;
  final String file;
  final String detail;
  @override
  String toString() => '[$rule] $file: $detail';
}

final _import = RegExp(
  r'''^\s*(?:import|export)\s+['"]([^'"]+)['"]''',
  multiLine: true,
);

List<String> importsOf(String source) =>
    _import.allMatches(source).map((m) => m.group(1)!).toList();

bool _isFlutter(String i) =>
    i.startsWith('package:flutter/') ||
    i.startsWith('package:material_ui/') ||
    i.startsWith('package:flutter_localizations/') ||
    i == 'dart:ui';

bool _isDio(String i) => i.startsWith('package:dio/');

const _pkg = 'package:multistore_app/';

/// [files] maps a path relative to the app root (for example `lib/features/catalog/domain/x.dart`)
/// to its text.
List<Violation> checkBoundaries(Map<String, String> files) {
  final out = <Violation>[];
  files.forEach((path, source) {
    if (!path.startsWith('lib/')) return;
    final imports = importsOf(source);
    final inDomain = RegExp(r'^lib/features/[^/]+/domain/').hasMatch(path);
    final inPresentation = RegExp(r'^lib/features/[^/]+/presentation/')
        .hasMatch(path);
    final inDesign = path.startsWith('lib/design_system/');
    final feature = RegExp(r'^lib/features/([^/]+)/')
        .firstMatch(path)
        ?.group(1);

    for (final i in imports) {
      if (inDomain && (_isFlutter(i) || _isDio(i))) {
        out.add(
          Violation(
            'domain-pure',
            path,
            'domain/ must not import Flutter or dio: $i',
          ),
        );
      }
      if (inPresentation && _isDio(i)) {
        out.add(
          Violation(
            'no-dio-in-screens',
            path,
            'screens read providers, never dio: $i',
          ),
        );
      }
      if (inDesign) {
        final ok =
            _isFlutter(i) ||
            i.startsWith('dart:') ||
            i.startsWith('${_pkg}design_system/') ||
            i.startsWith('${_pkg}l10n/');
        if (!ok) {
          out.add(
            Violation(
              'design-system-boundary',
              path,
              'design_system/ may import only Flutter, tokens, theme and layout: $i',
            ),
          );
        }
      }
      if (feature != null && i.startsWith('${_pkg}features/')) {
        final target = i.substring('${_pkg}features/'.length).split('/');
        final other = target.first;
        if (other != feature) {
          final isBarrel = target.length == 2 && target[1] == '$other.dart';
          if (!isBarrel) {
            out.add(
              Violation(
                'feature-barrel-only',
                path,
                'features may import another feature only through its barrel file: $i',
              ),
            );
          }
        }
      }
    }
    // RTL: directional insets and alignments only (spec 4.5 rule 4).
    final stripped = source.replaceAll(RegExp(r'//[^\n]*'), '');
    for (final bad in [
      RegExp(r'\bEdgeInsets\.(only|fromLTRB)\b'),
      RegExp(r'\bAlignment\.\w+'),
      RegExp(r'\bAlignment\('),
    ]) {
      if (bad.hasMatch(stripped)) {
        out.add(
          Violation(
            'rtl-directional',
            path,
            'use EdgeInsetsDirectional / AlignmentDirectional (matched ${bad.pattern})',
          ),
        );
      }
    }
  });
  return out;
}
