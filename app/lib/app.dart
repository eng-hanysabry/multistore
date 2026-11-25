import 'package:material_ui/material_ui.dart';
import 'package:multistore_app/design_system/layout/directional.dart';
import 'package:multistore_app/l10n/generated/app_localizations.dart';

/// Foundation shell. Feature screens arrive in later phases (IP-6 onward).
class App extends StatelessWidget {
  const App({super.key, this.locale});

  final Locale? locale;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      locale: locale,
      onGenerateTitle: (context) => AppLocalizations.of(context).appTitle,
      localizationsDelegates: [
        AppLocalizations.delegate,
        ...GlobalMaterialLocalizations.delegates,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      home: Builder(
        builder: (context) => Scaffold(
          appBar: AppBar(title: Text(AppLocalizations.of(context).appTitle)),
          body: Padding(
            padding: screenPadding(),
            child: Align(
              alignment: AlignmentDirectional.topStart,
              child: Text(AppLocalizations.of(context).foundationReady),
            ),
          ),
        ),
      ),
    );
  }
}
