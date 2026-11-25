import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:multistore_app/app.dart';

void main() {
  testWidgets('English LTR shell renders', (tester) async {
    await tester.pumpWidget(const App(locale: Locale('en')));
    await tester.pumpAndSettle();
    expect(find.text('Foundation ready'), findsOneWidget);
    expect(
      Directionality.of(tester.element(find.text('Foundation ready'))),
      TextDirection.ltr,
    );
  });

  testWidgets('Arabic RTL shell renders', (tester) async {
    await tester.pumpWidget(const App(locale: Locale('ar')));
    await tester.pumpAndSettle();
    expect(find.text('الأساس جاهز'), findsOneWidget);
    expect(
      Directionality.of(tester.element(find.text('الأساس جاهز'))),
      TextDirection.rtl,
    );
  });
}
