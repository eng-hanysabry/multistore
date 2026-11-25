import 'dart:io';

import 'boundaries.dart';

void main() {
  final files = <String, String>{};
  for (final e in Directory('lib').listSync(recursive: true)) {
    if (e is File && e.path.endsWith('.dart')) {
      files[e.path.replaceAll(r'\', '/')] = e.readAsStringSync();
    }
  }
  final v = checkBoundaries(files);
  v.forEach(stderr.writeln);
  stdout.writeln(
    'boundary check: ${files.length} files, ${v.length} violations',
  );
  exit(v.isEmpty ? 0 : 1);
}
