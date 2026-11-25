import 'package:flutter_test/flutter_test.dart';

import '../../tool/boundaries.dart';

List<String> rules(Map<String, String> files) =>
    checkBoundaries(files).map((v) => v.rule).toList();

void main() {
  test('domain must not import Flutter or dio (absolute)', () {
    expect(
      rules({
        'lib/features/catalog/domain/a.dart':
            "import 'package:flutter/material.dart';\n",
        'lib/features/catalog/domain/b.dart':
            "import 'package:dio/dio.dart';\n",
        'lib/features/catalog/domain/c.dart':
            "import 'package:material_ui/material_ui.dart';\n",
      }),
      everyElement('domain-pure'),
    );
  });

  test('screens never import dio', () {
    expect(
      rules({
        'lib/features/catalog/presentation/s.dart':
            "import 'package:dio/dio.dart';\n",
      }),
      ['no-dio-in-screens'],
    );
  });

  test('design_system imports only Flutter, tokens, theme and layout', () {
    expect(
      rules({
        'lib/design_system/components/b.dart':
            "import 'package:multistore_app/features/catalog/catalog.dart';\n",
      }),
      ['design-system-boundary'],
    );
    expect(
      rules({
        'lib/design_system/components/ok.dart': "import 'dart:math';\nimport 'package:material_ui/material_ui.dart';\nimport 'package:multistore_app/design_system/tokens/spacing.dart';\n",
      }),
      isEmpty,
    );
  });

  test('features may use another feature only through its barrel', () {
    expect(
      rules({
        'lib/features/store/presentation/x.dart':
            "import 'package:multistore_app/features/catalog/data/api.dart';\n",
      }),
      ['feature-barrel-only'],
    );
    expect(
      rules({
        'lib/features/store/presentation/x.dart': "import 'package:multistore_app/features/catalog/catalog.dart';\nimport 'package:multistore_app/features/store/domain/y.dart';\n",
      }),
      isEmpty,
    );
  });

  test('RTL: directional insets and alignments only', () {
    expect(
      rules({
        'lib/app.dart': 'final a = EdgeInsets.only(left: 1);\nfinal b = Alignment.centerLeft;\nfinal c = EdgeInsets.fromLTRB(1, 2, 3, 4);\nfinal d = Alignment(0, 0);\n',
      }),
      everyElement('rtl-directional'),
    );
    expect(
      rules({
        'lib/app.dart': '// EdgeInsets.only is banned\nfinal a = EdgeInsetsDirectional.only(start: 1);\n',
      }),
      isEmpty,
    );
  });

  test('non-lib files are ignored and importsOf reads import and export', () {
    expect(rules({'test/a.dart': "import 'package:dio/dio.dart';"}), isEmpty);
    expect(importsOf("import 'a.dart';\nexport 'b.dart';"), [
      'a.dart',
      'b.dart',
    ]);
    expect(const Violation('r', 'f', 'd').toString(), '[r] f: d');
  });
}
