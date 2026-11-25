import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';
import 'package:multistore_app/app.dart';
import 'package:multistore_app/core/config/environment.dart';

void main() {
  Environment.fromDefines().validate();
  runApp(const ProviderScope(child: App()));
}
