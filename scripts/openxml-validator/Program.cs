using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Validation;

if (args.Length != 1 || string.IsNullOrEmpty(args[0]))
{
    Console.Error.WriteLine("usage: kiro-openxml-validator <path-to.docx>");
    return 2;
}

var path = args[0];
if (!File.Exists(path))
{
    Console.Error.WriteLine($"file not found: {path}");
    return 2;
}

try
{
    using var document = WordprocessingDocument.Open(path, false);
    var validator = new OpenXmlValidator();
    var errors = validator.Validate(document).Take(50).ToList();

    foreach (var error in errors)
    {
        Console.WriteLine($"[{error.ErrorType}]");
        Console.WriteLine($"  Part: {error.Part?.Uri}");
        Console.WriteLine($"  Path: {error.Path?.XPath}");
        Console.WriteLine($"  Description: {error.Description}");
        Console.WriteLine($"  Node: {error.Node?.OuterXml}");
    }

    Console.WriteLine($"Validation errors: {errors.Count}");
    return errors.Count == 0 ? 0 : 1;
}
catch (Exception ex)
{
    Console.Error.WriteLine($"cannot open package: {ex.Message}");
    return 2;
}
